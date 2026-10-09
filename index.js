#!/usr/bin/env node
/**
 * chromecast2mqtt — Google Cast devices (Chromecast, Google Home and Nest speakers, Android TV)
 * to MQTT.
 *
 * Devices are found with mdns or pinned with --devices; every device keeps a Cast v2 connection
 * open and reports its volume, the running app and what plays as retained status items; the
 * commands set the volume, mute, control playback and play a url.
 */

import {createRequire} from 'node:module';
import {Bonjour} from 'bonjour-service';
import {createAdapter} from 'mqtt-interfaces-core';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {handle as handleInstall} from './lib/install.js';
import {CastBridge} from './lib/bridge.js';
import {CastDevice} from './lib/cast.js';
import {discoveryModel} from './lib/hadiscovery.js';

// castv2-client is CommonJS
const require = createRequire(import.meta.url);
const {Client, DefaultMediaReceiver} = require('castv2-client');

handleInstall(config);

let bridge = null;
let bonjour = null;

const adapter = createAdapter({
    pkg,
    config,
    deviceLabel: 'cast',
    info: () => ({
        discovery: Boolean(config.discovery),
        devices: bridge ? bridge.deviceList().map((d) => d.key) : [],
    }),
    discovery: () =>
        discoveryModel({
            name: config.name,
            jsonPayloads: config.jsonPayloads,
            devices: bridge ? bridge.deviceList() : [],
        }),
    onSet: (parts, value) => bridge.handleSet(parts, value),
    onShutdown: () => {
        bridge.stop();
        bonjour?.destroy();
    },
});

bridge = new CastBridge({
    adapter,
    config,
    createCast: (device) =>
        new CastDevice({
            host: device.host,
            port: device.port,
            label: device.name,
            log: adapter.log,
            createClient: () => new Client(),
            receiver: DefaultMediaReceiver,
            reconnectMs: config.reconnectInterval * 1000,
            positionMs: config.positionInterval * 1000,
        }),
    createBrowser: () => {
        bonjour = new Bonjour();
        return bonjour.find({type: 'googlecast'});
    },
});

adapter.start();
bridge.start();
