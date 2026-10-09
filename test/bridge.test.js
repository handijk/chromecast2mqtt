import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';

import {CastBridge} from '../lib/bridge.js';

const log = {info() {}, warn() {}, debug() {}, error() {}};

/** A CastDevice as the bridge sees it: events in, calls out. */
class FakeCast extends EventEmitter {
    constructor(device, calls) {
        super();
        this.device = device;
        this.calls = calls;
        this.connected = false;
    }
    connect() {
        this.calls.push(`${this.device.key}: connect ${this.device.host}`);
    }
    move(host) {
        this.calls.push(`${this.device.key}: move ${host}`);
    }
    online() {
        this.connected = true;
        this.emit('online');
    }
    offline() {
        this.connected = false;
        this.emit('offline');
    }
    async setVolume(level) {
        this.calls.push(`${this.device.key}: volume ${level}`);
    }
    async setMuted(m) {
        this.calls.push(`${this.device.key}: muted ${m}`);
    }
    async play() {
        this.calls.push(`${this.device.key}: play`);
    }
    async pause() {
        this.calls.push(`${this.device.key}: pause`);
    }
    async stopMedia() {
        this.calls.push(`${this.device.key}: stop`);
    }
    async seek(s) {
        this.calls.push(`${this.device.key}: seek ${s}`);
    }
    async load(media, {autoplay}) {
        this.calls.push(`${this.device.key}: load ${media.contentId} ${autoplay}`);
    }
    async quit() {
        this.calls.push(`${this.device.key}: quit`);
    }
    stop() {
        this.calls.push(`${this.device.key}: stopped`);
    }
}

function fakeAdapter() {
    const status = new Map();
    let discoveries = 0;
    return {
        log,
        status,
        connected: null,
        get discoveries() {
            return discoveries;
        },
        pubStatus(item, value) {
            status.set(item, value);
        },
        clearStatus(item) {
            status.delete(item);
        },
        setDeviceConnected(v) {
            this.connected = v;
        },
        markDiscoveryDirty() {},
        publishDiscovery() {
            discoveries++;
        },
    };
}

function makeBridge(config = {}) {
    const adapter = fakeAdapter();
    const calls = [];
    const casts = new Map();
    const browser = new EventEmitter();
    browser.updates = 0;
    browser.update = () => browser.updates++;
    browser.stop = () => calls.push('browser stopped');
    const bridge = new CastBridge({
        adapter,
        config: {discovery: true, deviceTopics: 'name', reconnectInterval: 10, positionInterval: 0, ...config},
        createCast: (device) => {
            const cast = new FakeCast(device, calls);
            casts.set(device.key, cast);
            return cast;
        },
        createBrowser: () => browser,
        log,
    });
    return {bridge, adapter, calls, casts, browser};
}

const service = (fn, id, host) => ({
    name: `${fn}-${id}`,
    port: 8009,
    addresses: [host],
    txt: {fn, id, md: 'Chromecast'},
});

describe('bridge', () => {
    test('an mdns device becomes a connection and status items; its events become items', () => {
        const {bridge, adapter, calls, casts} = makeBridge();
        bridge.start();
        assert.equal(adapter.connected, false);
        bridge.browser.emit('up', service('Living Room', 'abc', '10.0.0.1'));
        assert.deepEqual(calls, ['living_room: connect 10.0.0.1']);
        assert.equal(adapter.status.get('living_room/online'), false);
        assert.equal(adapter.status.get('living_room/name'), 'Living Room');
        assert.equal(adapter.status.get('living_room/model'), 'Chromecast');
        assert.equal(adapter.discoveries, 1);
        const cast = casts.get('living_room');
        cast.online();
        assert.equal(adapter.status.get('living_room/online'), true);
        assert.equal(adapter.connected, true);
        cast.emit('receiver', {
            applications: [{appId: 'CC32E753', displayName: 'Spotify'}],
            volume: {level: 0.5, muted: false},
        });
        assert.equal(adapter.status.get('living_room/app'), 'Spotify');
        assert.equal(adapter.status.get('living_room/volume'), 0.5);
        cast.emit('media', {playerState: 'PLAYING', media: {metadata: {title: 'Song', artist: 'Band'}}});
        assert.equal(adapter.status.get('living_room/player_state'), 'PLAYING');
        assert.equal(adapter.status.get('living_room/title'), 'Song');
        cast.offline();
        assert.equal(adapter.status.get('living_room/online'), false);
        assert.equal(adapter.status.get('living_room/player_state'), 'IDLE');
        assert.equal(adapter.status.get('living_room/app'), null);
        assert.equal(adapter.connected, false);
        assert.deepEqual(
            bridge.deviceList().map((d) => [d.key, d.name, d.items.title]),
            [['living_room', 'Living Room', null]],
        );
    });

    test('a device seen again at another address moves; pinned devices need no mdns', () => {
        const {bridge, calls} = makeBridge({discovery: false, devices: 'tv=10.0.0.3'});
        bridge.start();
        assert.equal(bridge.browser, null);
        assert.deepEqual(calls, ['tv: connect 10.0.0.3']);
        bridge.seen({id: null, name: 'tv', host: '10.0.0.3', port: 8009});
        assert.equal(calls.length, 1, 'the same device again is nothing new');
        bridge.seen({id: null, name: 'tv', host: '10.0.0.4', port: 8009});
        assert.equal(calls.at(-1), 'tv: move 10.0.0.4');
    });

    test('commands go to the right device; unknown devices and items are refused', async () => {
        const {bridge, calls} = makeBridge();
        bridge.start();
        bridge.browser.emit('up', service('Kitchen', 'k1', '10.0.0.5'));
        bridge.browser.emit('up', service('Living Room', 'l1', '10.0.0.1'));
        await bridge.handleSet(['kitchen', 'volume'], 40);
        await bridge.handleSet(['living_room', 'muted'], 'true');
        await bridge.handleSet(['living_room', 'player_state'], 'pause');
        await bridge.handleSet(['living_room', 'seek'], 10);
        await bridge.handleSet(['kitchen', 'play'], 'https://h/radio.aac');
        await bridge.handleSet(['kitchen', 'quit'], '');
        assert.deepEqual(calls.slice(2), [
            'kitchen: volume 0.4',
            'living_room: muted true',
            'living_room: pause',
            'living_room: seek 10',
            'kitchen: load https://h/radio.aac true',
            'kitchen: quit',
        ]);
        await assert.rejects(bridge.handleSet(['garage', 'volume'], 1), /unknown device/);
        await assert.rejects(bridge.handleSet(['kitchen', 'colour'], 1), /unknown item/);
        bridge.stop();
        assert.ok(calls.includes('kitchen: stopped') && calls.includes('browser stopped'));
    });
});
