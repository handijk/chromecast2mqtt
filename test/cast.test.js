import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';

import {CastDevice} from '../lib/cast.js';

const log = {info() {}, warn() {}, debug() {}, error() {}};
const MEDIA_NS = {name: 'urn:x-cast:com.google.cast.media'};
const Receiver = {};

/** castv2-client's Client as far as CastDevice uses it. */
class FakeClient extends EventEmitter {
    constructor(world) {
        super();
        this.world = world;
        world.clients.push(this);
        this.calls = world.calls;
    }
    connect(opts, cb) {
        this.calls.push(`connect ${opts.host}:${opts.port}`);
        if (this.world.refuse) {
            setImmediate(() => this.emit('error', new Error('ECONNREFUSED')));
            return;
        }
        setImmediate(cb);
    }
    getStatus(cb) {
        this.calls.push('getStatus');
        cb(null, this.world.receiverStatus);
    }
    setVolume(v, cb) {
        this.calls.push(`setVolume ${JSON.stringify(v)}`);
        cb(null, v);
    }
    join(app, receiver, cb) {
        this.calls.push(`join ${app.displayName}`);
        const player = new FakePlayer(this.world);
        this.world.player = player;
        setImmediate(() => cb(null, player));
    }
    launch(receiver, cb) {
        this.calls.push('launch');
        const player = new FakePlayer(this.world);
        this.world.player = player;
        setImmediate(() => cb(null, player));
    }
    stop(opts, cb) {
        this.calls.push(`stop ${opts.session.displayName}`);
        cb(null);
    }
    close() {
        this.calls.push('close');
    }
}

class FakePlayer extends EventEmitter {
    constructor(world) {
        super();
        this.world = world;
        this.calls = world.calls;
    }
    getStatus(cb) {
        this.calls.push('player.getStatus');
        cb(null, this.world.mediaStatus);
    }
    play(cb) {
        this.calls.push('player.play');
        cb(null);
    }
    pause(cb) {
        this.calls.push('player.pause');
        cb(null);
    }
    stop(cb) {
        this.calls.push('player.stop');
        cb(null);
    }
    seek(s, cb) {
        this.calls.push(`player.seek ${s}`);
        cb(null);
    }
    load(media, opts, cb) {
        this.calls.push(`player.load ${media.contentId} autoplay=${opts.autoplay}`);
        cb(null, {playerState: 'BUFFERING', media});
    }
}

const spotify = {appId: 'CC32E753', displayName: 'Spotify', sessionId: 's1', namespaces: [MEDIA_NS]};
const backdrop = {appId: 'E8C28D3C', displayName: 'Backdrop', isIdleScreen: true, sessionId: 's0'};

function world(overrides = {}) {
    return {
        clients: [],
        calls: [],
        refuse: false,
        receiverStatus: {applications: [backdrop], volume: {level: 0.5, muted: false}},
        mediaStatus: {playerState: 'PLAYING', currentTime: 1, media: {metadata: {title: 'Song'}}},
        player: null,
        ...overrides,
    };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function device(w, extra = {}) {
    const events = [];
    const d = new CastDevice({
        host: '10.0.0.1',
        label: 'tv',
        log,
        createClient: () => new FakeClient(w),
        receiver: Receiver,
        reconnectMs: 10,
        ...extra,
    });
    for (const ev of ['online', 'offline', 'receiver', 'media']) {
        d.on(ev, (payload) => events.push([ev, payload]));
    }
    return {d, events};
}

describe('cast device', () => {
    test('connects, reads the receiver status, joins a media app and reports what plays', async () => {
        const w = world();
        const {d, events} = device(w);
        d.connect();
        await tick();
        assert.equal(d.connected, true);
        assert.deepEqual(
            events.map((e) => e[0]),
            ['online', 'receiver', 'media'],
        );
        assert.equal(events[2][1], null, 'the idle screen has no media');
        // Spotify starts
        w.clients[0].emit('status', {applications: [spotify], volume: {level: 0.5, muted: false}});
        await tick();
        assert.ok(w.calls.includes('join Spotify'));
        assert.equal(events.at(-1)[0], 'media');
        assert.equal(events.at(-1)[1].media.metadata.title, 'Song');
        // a player event
        w.player.emit('status', {playerState: 'PAUSED'});
        assert.equal(events.at(-1)[1].playerState, 'PAUSED');
        // the same session again: no second join
        const joins = w.calls.filter((c) => c === 'join Spotify').length;
        w.clients[0].emit('status', {applications: [spotify], volume: {level: 0.6, muted: false}});
        await tick();
        assert.equal(w.calls.filter((c) => c === 'join Spotify').length, joins);
        // back to the idle screen
        w.clients[0].emit('status', {applications: [backdrop], volume: {level: 0.6, muted: false}});
        assert.equal(events.at(-1)[1], null);
        assert.equal(d.player, null);
        d.stop();
    });

    test('commands reach the client and the player; without a player they fail clearly', async () => {
        const w = world({receiverStatus: {applications: [spotify], volume: {level: 0.5, muted: false}}});
        const {d} = device(w);
        d.connect();
        await tick();
        await d.setVolume(0.3);
        await d.setMuted(true);
        await d.pause();
        await d.seek(42);
        await d.play();
        await d.quit();
        assert.deepEqual(w.calls.slice(-6), [
            'setVolume {"level":0.3}',
            'setVolume {"muted":true}',
            'player.pause',
            'player.seek 42',
            'player.play',
            'stop Spotify',
        ]);
        w.clients[0].emit('status', {applications: [backdrop], volume: {level: 0.5, muted: false}});
        await assert.rejects(d.play(), /nothing is playing/);
        const status = await d.load({contentId: 'https://h/a.mp3', contentType: 'audio/mpeg'}, {autoplay: true});
        assert.equal(status.playerState, 'BUFFERING');
        assert.ok(w.calls.includes('launch'));
        assert.ok(w.calls.includes('player.load https://h/a.mp3 autoplay=true'));
        d.stop();
        await assert.rejects(d.setVolume(1), /not connected/);
    });

    test('a lost connection comes back by itself; a refused one keeps trying quietly', async () => {
        const w = world();
        const {d, events} = device(w);
        d.connect();
        await tick();
        w.clients[0].emit('close');
        assert.equal(d.connected, false);
        assert.equal(events.at(-1)[0], 'offline');
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(w.clients.length, 2, 'a new client after the reconnect delay');
        assert.equal(d.connected, true);
        d.stop();

        const refused = world({refuse: true});
        const {d: d2, events: e2} = device(refused);
        d2.connect();
        await new Promise((r) => setTimeout(r, 60));
        assert.ok(refused.clients.length >= 3, 'keeps trying');
        assert.equal(e2.length, 0, 'never online, so never offline');
        d2.stop();
    });

    test('moving to another address reconnects there', async () => {
        const w = world();
        const {d} = device(w);
        d.connect();
        await tick();
        d.move('10.0.0.9');
        await tick();
        assert.equal(w.calls.filter((c) => c.startsWith('connect')).at(-1), 'connect 10.0.0.9:8009');
        assert.equal(d.connected, true);
        d.stop();
    });
});
