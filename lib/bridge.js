/**
 * The bridge: the devices (pinned or found with mdns), one CastDevice per device, its events as
 * status items under `status/<key>/...`, the commands from `set/<key>/...`. Everything that
 * touches MQTT goes through the adapter, so a test can hand in fakes for the adapter, the
 * CastDevice factory and the mdns browser.
 */

import {mediaItems, parseCommand, receiverItems} from './items.js';
import {fromService, parsePinned, Registry} from './devices.js';

export class CastBridge {
    /**
     * @param {object} a
     * @param {object} a.adapter from createAdapter (log, pubStatus, setDeviceConnected, markDiscoveryDirty, publishDiscovery)
     * @param {object} a.config devices, discovery, deviceTopics, reconnectInterval, positionInterval
     * @param {(device: object) => import('./cast.js').CastDevice} a.createCast
     * @param {() => {on: Function, update?: Function, stop: Function}} [a.createBrowser] mdns browser ('up'/'down' with services)
     * @param {object} [a.log]
     */
    constructor({adapter, config, createCast, createBrowser, log}) {
        this.adapter = adapter;
        this.config = config;
        this.createCast = createCast;
        this.createBrowser = createBrowser;
        this.log = log || adapter.log;
        this.registry = new Registry({mode: config.deviceTopics});
        this.casts = new Map(); // key → CastDevice
        this.items = new Map(); // key → last items
        this.browser = null;
        this.rescan = null;
    }

    /** For discovery: the devices with what is known about them. */
    deviceList() {
        return this.registry.list().map((device) => ({...device, items: this.items.get(device.key) || {}}));
    }

    start() {
        for (const pinned of parsePinned(this.config.devices)) {
            this.seen({id: null, name: pinned.name, model: null, host: pinned.host, port: pinned.port});
        }
        if (this.config.discovery && this.createBrowser) {
            this.browser = this.createBrowser();
            this.browser.on('up', (service) => this.seen(fromService(service)));
            this.browser.on('down', (service) => this.gone(fromService(service)));
            // mdns answers are not forever: ask again now and then for devices that came back
            if (typeof this.browser.update === 'function') {
                this.rescan = setInterval(() => this.browser.update(), 60_000);
                this.rescan.unref?.();
            }
            this.log.info('mdns looking for cast devices');
        }
        this.updateConnected();
    }

    /** A device is there: new, or known (perhaps elsewhere). */
    seen(info) {
        if (!info.host) {
            return;
        }
        const {device, added, changed} = this.registry.upsert(info);
        if (added) {
            this.log.info(
                `cast device "${device.name}"${device.model ? ` (${device.model})` : ''} at ${device.host} → ${device.key}`,
            );
            const cast = this.createCast(device);
            this.casts.set(device.key, cast);
            this.wire(device, cast);
            this.publish(device.key, {
                online: false,
                name: device.name,
                model: device.model,
                address: device.host,
                id: device.id,
            });
            cast.connect();
            this.adapter.markDiscoveryDirty();
            this.adapter.publishDiscovery();
        } else if (changed) {
            this.log.info(`cast device "${device.name}" is now at ${device.host}`);
            this.publish(device.key, {name: device.name, address: device.host});
            this.casts.get(device.key).move(device.host, device.port);
        }
    }

    /** mdns says a device is gone; the connection tells on its own, nothing to do but note it. */
    gone(info) {
        const device = this.registry.find(info);
        if (device) {
            this.log.debug(`mdns: "${device.name}" announced itself gone`);
        }
    }

    wire(device, cast) {
        const key = device.key;
        cast.on('online', () => {
            this.publish(key, {online: true});
            this.updateConnected();
        });
        cast.on('offline', () => {
            this.publish(key, {online: false, ...receiverItems(null), ...mediaItems(null)});
            this.updateConnected();
        });
        cast.on('receiver', (status) => this.publish(key, receiverItems(status)));
        cast.on('media', (status) => this.publish(key, mediaItems(status)));
    }

    publish(key, items) {
        const known = this.items.get(key) || {};
        this.items.set(key, {...known, ...items});
        for (const [item, value] of Object.entries(items)) {
            this.adapter.pubStatus(`${key}/${item}`, value);
        }
    }

    /** `connected` 2 while at least one device is connected. */
    updateConnected() {
        const any = [...this.casts.values()].some((c) => c.connected);
        this.adapter.setDeviceConnected(any);
    }

    /** `set/<key>/<item>` */
    async handleSet(parts, value) {
        const command = parseCommand(parts, value);
        const cast = this.casts.get(command.key);
        if (!cast) {
            throw new Error(`unknown device ${command.key}`);
        }
        const name = this.registry.devices.get(command.key).name;
        switch (command.kind) {
            case 'volume':
                await cast.setVolume(command.level);
                this.log.info(`${name}: volume ${command.level}`);
                return;
            case 'muted':
                await cast.setMuted(command.muted);
                this.log.info(`${name}: ${command.muted ? 'muted' : 'unmuted'}`);
                return;
            case 'player':
                if (command.action === 'play') {
                    await cast.play();
                } else if (command.action === 'pause') {
                    await cast.pause();
                } else {
                    await cast.stopMedia();
                }
                this.log.info(`${name}: ${command.action}`);
                return;
            case 'seek':
                await cast.seek(command.seconds);
                this.log.info(`${name}: seek ${command.seconds} s`);
                return;
            case 'load':
                await cast.load(command.media, {autoplay: command.autoplay});
                this.log.info(`${name}: playing ${command.media.contentId}`);
                return;
            case 'quit':
                await cast.quit();
                this.log.info(`${name}: app closed`);
                return;
        }
    }

    stop() {
        if (this.rescan) {
            clearInterval(this.rescan);
            this.rescan = null;
        }
        if (this.browser) {
            try {
                this.browser.stop();
            } catch {
                // fine
            }
            this.browser = null;
        }
        for (const cast of this.casts.values()) {
            cast.stop();
        }
    }
}
