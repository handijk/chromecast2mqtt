/**
 * The item table: a receiver status and a media status become status items, a set/... topic
 * becomes a command. Pure functions over the Cast v2 message shapes castv2-client delivers.
 */

import {toBoolean} from 'mqtt-interfaces-core';

/** The idle screen ("Backdrop") of a Chromecast: an app, but nothing plays. */
export const IDLE_APP_ID = 'E8C28D3C';
export const MEDIA_NAMESPACE = 'urn:x-cast:com.google.cast.media';

/** Topic level for a friendly name: lower case, runs of anything but letters and digits become one `_`. */
export function slugify(name) {
    return (
        String(name)
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '_')
            .replace(/^_+|_+$/g, '') || 'device'
    );
}

/** The running application of a receiver status, or null when none or the idle screen. */
export function runningApp(status) {
    const app = status && Array.isArray(status.applications) ? status.applications[0] : null;
    if (!app) {
        return null;
    }
    return app;
}

export function isIdleApp(app) {
    return !app || app.isIdleScreen === true || app.appId === IDLE_APP_ID;
}

/** Does the running app speak the media namespace (so a media session can be joined)? */
export function hasMedia(app) {
    return Boolean(app && Array.isArray(app.namespaces) && app.namespaces.some((n) => n && n.name === MEDIA_NAMESPACE));
}

/**
 * Items from a receiver status (volume and the running app).
 * @param {object} status castv2-client receiver status: {applications: [...], volume: {level, muted}}
 */
export function receiverItems(status) {
    const app = runningApp(status);
    const idle = isIdleApp(app);
    const volume = status && status.volume ? status.volume : {};
    return {
        volume: typeof volume.level === 'number' ? Math.round(volume.level * 100) / 100 : null,
        muted: typeof volume.muted === 'boolean' ? volume.muted : null,
        app: app && !idle ? app.displayName || null : null,
        app_id: app && !idle ? app.appId || null : null,
        idle,
        status_text: app && !idle ? app.statusText || null : null,
    };
}

/** The items of a media session that is gone. */
export const NO_MEDIA = {
    player_state: 'IDLE',
    title: null,
    artist: null,
    album: null,
    content_type: null,
    content_id: null,
    stream_type: null,
    duration: null,
    position: null,
    image: null,
    idle_reason: null,
};

/**
 * Items from a media status (the player of the running app).
 * @param {object | null} status castv2-client media status: {playerState, currentTime, media: {contentId, contentType, streamType, duration, metadata}}
 */
export function mediaItems(status) {
    if (!status) {
        return {...NO_MEDIA};
    }
    const media = status.media || {};
    const meta = media.metadata || {};
    const image = Array.isArray(meta.images) && meta.images[0] && meta.images[0].url ? meta.images[0].url : null;
    return {
        player_state: status.playerState || 'IDLE',
        title: meta.title || meta.songName || null,
        artist: meta.artist || meta.albumArtist || meta.subtitle || null,
        album: meta.albumName || null,
        content_type: media.contentType || null,
        content_id: media.contentId || null,
        stream_type: media.streamType || null,
        duration: typeof media.duration === 'number' ? Math.round(media.duration * 10) / 10 : null,
        position: typeof status.currentTime === 'number' ? Math.round(status.currentTime * 10) / 10 : null,
        image,
        idle_reason: status.idleReason || null,
    };
}

function volumeOf(value) {
    const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n)) {
        throw new Error(`not a volume: ${value}`);
    }
    // 0..1 is the cast scale; 2..100 reads as percent
    const level = n > 1 ? n / 100 : n;
    return Math.max(0, Math.min(1, Math.round(level * 100) / 100));
}

/**
 * A command from `set/<key>/<item>` with its parsed payload.
 *
 *   set/<key>/volume        0.35 (or 35)            the volume
 *   set/<key>/muted         true|false
 *   set/<key>/player_state  play|pause|stop         the current media session
 *   set/<key>/seek          120                     seconds into the current media
 *   set/<key>/play          "https://..." or {url, content_type, title, image, stream_type}
 *   set/<key>/quit          anything                closes the running app
 *
 * @returns {{kind: string, key: string, ...}}
 */
export function parseCommand(parts, value) {
    if (parts.length !== 2) {
        throw new Error(`unknown item ${parts.join('/')}`);
    }
    const [key, item] = parts;
    switch (item) {
        case 'volume':
            return {kind: 'volume', key, level: volumeOf(value)};
        case 'muted': {
            const muted = toBoolean(value);
            if (muted === undefined) {
                throw new Error(`muted must be true or false, not "${value}"`);
            }
            return {kind: 'muted', key, muted};
        }
        case 'player_state':
        case 'command': {
            const action = String(value).trim().toLowerCase();
            const map = {play: 'play', resume: 'play', playing: 'play', pause: 'pause', paused: 'pause', stop: 'stop'};
            if (!map[action]) {
                throw new Error(`player_state must be play, pause or stop, not "${value}"`);
            }
            return {kind: 'player', key, action: map[action]};
        }
        case 'seek': {
            const seconds = Number(value);
            if (!Number.isFinite(seconds) || seconds < 0) {
                throw new Error(`seek needs seconds, not "${value}"`);
            }
            return {kind: 'seek', key, seconds};
        }
        case 'play': {
            const o = value && typeof value === 'object' ? value : {url: value};
            if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) {
                throw new Error('play needs a http(s) url');
            }
            return {
                kind: 'load',
                key,
                media: {
                    contentId: o.url,
                    contentType: o.content_type || guessContentType(o.url),
                    streamType: String(o.stream_type || 'BUFFERED').toUpperCase() === 'LIVE' ? 'LIVE' : 'BUFFERED',
                    metadata: {
                        type: 0,
                        metadataType: 0,
                        ...(o.title && {title: String(o.title)}),
                        ...(o.image && {images: [{url: String(o.image)}]}),
                    },
                },
                autoplay: o.autoplay === undefined ? true : toBoolean(o.autoplay) !== false,
            };
        }
        case 'quit':
            return {kind: 'quit', key};
        default:
            throw new Error(`unknown item ${parts.join('/')}`);
    }
}

/** A content type from the url's extension; what a stream usually is otherwise. */
export function guessContentType(url) {
    const path = url.split('?')[0].toLowerCase();
    const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : '';
    const types = {
        mp3: 'audio/mpeg',
        aac: 'audio/aac',
        m4a: 'audio/mp4',
        ogg: 'audio/ogg',
        opus: 'audio/ogg',
        flac: 'audio/flac',
        wav: 'audio/wav',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        m3u8: 'application/x-mpegURL',
        mpd: 'application/dash+xml',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
    };
    return types[ext] || 'audio/mpeg';
}
