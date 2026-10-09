import {parseConfig} from 'mqtt-interfaces-core';
import pkg from './package.json' with {type: 'json'};

export const OPTIONS = {
    devices: {
        alias: 'd',
        type: 'string',
        describe:
            'cast devices to connect to without mdns, as <name>=<host>[:<port>],... (the name becomes the topic level)',
    },
    discovery: {
        type: 'boolean',
        describe: 'find cast devices with mdns (_googlecast._tcp); use --no-discovery with --devices only',
        default: true,
    },
    'device-topics': {
        type: 'string',
        describe: 'name the device topics after the friendly name (living_room) or the cast id (uuid)',
        choices: ['name', 'id'],
        default: 'name',
    },
    'reconnect-interval': {
        type: 'number',
        describe: 'seconds between connection attempts to a device that is gone',
        default: 10,
    },
    'position-interval': {
        type: 'number',
        describe: 'seconds between position updates while something plays (0 = only on player events)',
        default: 10,
    },
};

export default parseConfig({
    pkg,
    options: OPTIONS,
    defaults: {name: 'chromecast'},
    examples: [
        ['$0 -u mqtt://broker', 'find every cast device with mdns and run in the foreground'],
        ['$0 -u mqtt://broker --no-discovery -d living_room=192.168.1.20', 'one device, no mdns'],
        ['sudo $0 --install -n chromecast -u mqtt://broker', 'install as service chromecast2mqtt@chromecast'],
    ],
});
