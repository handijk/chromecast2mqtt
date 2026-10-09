/**
 * One cast device over castv2-client: a connection that is kept open and reconnected, the
 * receiver status (volume, running app) as events, the media session of the running app joined
 * for its status (player state, what plays), and the commands. The client class is injectable,
 * so the logic runs against a fake in the tests.
 */

import {EventEmitter} from 'node:events';
import {hasMedia, isIdleApp, runningApp} from './items.js';

const call = (fn) =>
    new Promise((resolve, reject) => {
        try {
            fn((err, result) => (err ? reject(err) : resolve(result)));
        } catch (err) {
            reject(err);
        }
    });

export class CastDevice extends EventEmitter {
    /**
     * @param {object} a
     * @param {string} a.host
     * @param {number} [a.port]
     * @param {string} a.label for log lines
     * @param {object} a.log
     * @param {() => object} a.createClient castv2-client's Client, or a fake
     * @param {object} a.receiver castv2-client's DefaultMediaReceiver (the media app to join)
     * @param {number} [a.reconnectMs]
     * @param {number} [a.positionMs] poll the media status this often while playing (0 = never)
     */
    constructor({host, port = 8009, label, log, createClient, receiver, reconnectMs = 10_000, positionMs = 0}) {
        super();
        this.host = host;
        this.port = port;
        this.label = label;
        this.log = log;
        this.createClient = createClient;
        this.receiver = receiver;
        this.reconnectMs = reconnectMs;
        this.positionMs = positionMs;
        this.client = null;
        this.player = null;
        this.app = null;
        this.connected = false;
        this.stopped = false;
        this.timer = null;
        this.positionTimer = null;
        this.failures = 0;
    }

    /** Where the device is now (mdns saw it move): reconnect there. */
    move(host, port = 8009) {
        if (host === this.host && port === this.port) {
            return;
        }
        this.host = host;
        this.port = port;
        this.disconnect();
        this.connect();
    }

    connect() {
        if (this.stopped || this.client) {
            return;
        }
        const client = this.createClient();
        this.client = client;
        this.log.debug(`${this.label} < connecting ${this.host}:${this.port}`);
        client.on('error', (err) => {
            if (this.client !== client) {
                return;
            }
            if (this.failures === 0) {
                this.log.warn(`${this.label}: ${err.message}`);
            }
            this.failures++;
            this.lost();
        });
        client.on('close', () => {
            if (this.client !== client) {
                return;
            }
            this.lost();
        });
        client.on('status', (status) => {
            if (this.client === client) {
                this.onReceiverStatus(status);
            }
        });
        try {
            client.connect({host: this.host, port: this.port}, () => {
                if (this.client !== client) {
                    return;
                }
                this.failures = 0;
                this.connected = true;
                this.log.info(`${this.label} connected (${this.host})`);
                this.emit('online');
                client.getStatus((err, status) => {
                    if (!err && this.client === client) {
                        this.onReceiverStatus(status);
                    }
                });
            });
        } catch (err) {
            this.log.warn(`${this.label}: ${err.message}`);
            this.lost();
        }
    }

    /** The connection is gone: tell, clean up, try again later. */
    lost() {
        const was = this.connected;
        this.disconnect();
        if (was) {
            this.log.info(`${this.label} disconnected`);
        }
        if (this.stopped) {
            return;
        }
        if (was) {
            this.emit('offline');
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.connect();
        }, this.reconnectMs);
        this.timer.unref?.();
    }

    disconnect() {
        clearTimeout(this.timer);
        this.timer = null;
        this.stopPosition();
        this.player = null;
        this.app = null;
        const client = this.client;
        this.client = null;
        this.connected = false;
        if (client) {
            try {
                client.close();
            } catch {
                // already closed
            }
        }
    }

    stop() {
        this.stopped = true;
        this.disconnect();
    }

    onReceiverStatus(status) {
        this.emit('receiver', status);
        const app = runningApp(status);
        if (isIdleApp(app) || !hasMedia(app)) {
            if (this.player) {
                this.player = null;
                this.stopPosition();
            }
            this.app = null;
            this.emit('media', null);
            return;
        }
        if (this.app && this.app.sessionId === app.sessionId && this.player) {
            return;
        }
        this.app = app;
        this.player = null;
        const client = this.client;
        client.join(app, this.receiver, (err, player) => {
            if (err || !player || this.client !== client || this.app !== app) {
                if (err) {
                    this.log.debug(`${this.label}: cannot join ${app.displayName}: ${err.message}`);
                }
                return;
            }
            this.player = player;
            player.on('status', (media) => {
                if (this.player === player) {
                    this.onMediaStatus(media);
                }
            });
            player.getStatus((e, media) => {
                if (!e && this.player === player) {
                    this.onMediaStatus(media);
                }
            });
        });
    }

    onMediaStatus(media) {
        this.emit('media', media || null);
        if (media && media.playerState === 'PLAYING') {
            this.startPosition();
        } else {
            this.stopPosition();
        }
    }

    startPosition() {
        if (this.positionTimer || !(this.positionMs > 0)) {
            return;
        }
        this.positionTimer = setInterval(() => {
            const player = this.player;
            if (!player) {
                this.stopPosition();
                return;
            }
            player.getStatus((err, media) => {
                if (!err && this.player === player) {
                    this.emit('media', media || null);
                }
            });
        }, this.positionMs);
        this.positionTimer.unref?.();
    }

    stopPosition() {
        if (this.positionTimer) {
            clearInterval(this.positionTimer);
            this.positionTimer = null;
        }
    }

    requireClient() {
        if (!this.client || !this.connected) {
            throw new Error(`${this.label} is not connected`);
        }
        return this.client;
    }

    requirePlayer() {
        if (!this.player) {
            throw new Error(`${this.label}: nothing is playing that can be controlled`);
        }
        return this.player;
    }

    async setVolume(level) {
        const client = this.requireClient();
        return call((cb) => client.setVolume({level}, cb));
    }

    async setMuted(muted) {
        const client = this.requireClient();
        return call((cb) => client.setVolume({muted}, cb));
    }

    async play() {
        const player = this.requirePlayer();
        return call((cb) => player.play(cb));
    }

    async pause() {
        const player = this.requirePlayer();
        return call((cb) => player.pause(cb));
    }

    async stopMedia() {
        const player = this.requirePlayer();
        return call((cb) => player.stop(cb));
    }

    async seek(seconds) {
        const player = this.requirePlayer();
        return call((cb) => player.seek(seconds, cb));
    }

    /** Launch the default media receiver and load media into it. */
    async load(media, {autoplay = true} = {}) {
        const client = this.requireClient();
        const player = await call((cb) => client.launch(this.receiver, cb));
        if (this.client !== client) {
            throw new Error(`${this.label} went away while launching`);
        }
        this.player = player;
        player.on('status', (status) => {
            if (this.player === player) {
                this.onMediaStatus(status);
            }
        });
        const status = await call((cb) => player.load(media, {autoplay}, cb));
        this.onMediaStatus(status);
        return status;
    }

    /** Close the running app (back to the idle screen). */
    async quit() {
        const client = this.requireClient();
        const app = this.app;
        if (!app) {
            return;
        }
        await call((cb) => client.stop({session: app}, cb));
    }
}
