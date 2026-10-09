import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {guessContentType, hasMedia, mediaItems, parseCommand, receiverItems, slugify} from '../lib/items.js';

const MEDIA_NS = {name: 'urn:x-cast:com.google.cast.media'};

describe('receiver status', () => {
    test('the idle screen is no app', () => {
        const items = receiverItems({
            applications: [{appId: 'E8C28D3C', displayName: 'Backdrop', isIdleScreen: true, statusText: ''}],
            volume: {level: 0.4567, muted: false},
        });
        assert.deepEqual(items, {volume: 0.46, muted: false, app: null, app_id: null, idle: true, status_text: null});
    });

    test('a running app', () => {
        const items = receiverItems({
            applications: [
                {appId: 'CC32E753', displayName: 'Spotify', statusText: 'Casting: Han', namespaces: [MEDIA_NS]},
            ],
            volume: {level: 1, muted: true},
        });
        assert.deepEqual(items, {
            volume: 1,
            muted: true,
            app: 'Spotify',
            app_id: 'CC32E753',
            idle: false,
            status_text: 'Casting: Han',
        });
        assert.equal(hasMedia({namespaces: [MEDIA_NS]}), true);
        assert.equal(hasMedia({namespaces: []}), false);
    });

    test('no status at all', () => {
        assert.deepEqual(receiverItems(null), {
            volume: null,
            muted: null,
            app: null,
            app_id: null,
            idle: true,
            status_text: null,
        });
    });
});

describe('media status', () => {
    test('what plays', () => {
        const items = mediaItems({
            playerState: 'PLAYING',
            currentTime: 12.345,
            media: {
                contentId: 'https://host/a.mp3',
                contentType: 'audio/mpeg',
                streamType: 'BUFFERED',
                duration: 240.7,
                metadata: {title: 'Song', artist: 'Band', albumName: 'Album', images: [{url: 'https://host/a.jpg'}]},
            },
        });
        assert.deepEqual(items, {
            player_state: 'PLAYING',
            title: 'Song',
            artist: 'Band',
            album: 'Album',
            content_type: 'audio/mpeg',
            content_id: 'https://host/a.mp3',
            stream_type: 'BUFFERED',
            duration: 240.7,
            position: 12.3,
            image: 'https://host/a.jpg',
            idle_reason: null,
        });
    });

    test('nothing plays', () => {
        assert.equal(mediaItems(null).player_state, 'IDLE');
        assert.equal(mediaItems(null).title, null);
        const finished = mediaItems({playerState: 'IDLE', idleReason: 'FINISHED'});
        assert.equal(finished.idle_reason, 'FINISHED');
        assert.equal(finished.position, null);
    });
});

describe('commands', () => {
    test('volume on both scales, mute', () => {
        assert.deepEqual(parseCommand(['tv', 'volume'], 0.35), {kind: 'volume', key: 'tv', level: 0.35});
        assert.deepEqual(parseCommand(['tv', 'volume'], 35), {kind: 'volume', key: 'tv', level: 0.35});
        assert.deepEqual(parseCommand(['tv', 'volume'], '1'), {kind: 'volume', key: 'tv', level: 1});
        assert.deepEqual(parseCommand(['tv', 'volume'], 150).level, 1);
        assert.throws(() => parseCommand(['tv', 'volume'], 'loud'), /not a volume/);
        assert.deepEqual(parseCommand(['tv', 'muted'], 'on'), {kind: 'muted', key: 'tv', muted: true});
        assert.throws(() => parseCommand(['tv', 'muted'], 'maybe'), /true or false/);
    });

    test('playback', () => {
        assert.deepEqual(parseCommand(['tv', 'player_state'], 'PAUSE'), {kind: 'player', key: 'tv', action: 'pause'});
        assert.deepEqual(parseCommand(['tv', 'command'], 'resume').action, 'play');
        assert.throws(() => parseCommand(['tv', 'player_state'], 'rewind'), /play, pause or stop/);
        assert.deepEqual(parseCommand(['tv', 'seek'], '90'), {kind: 'seek', key: 'tv', seconds: 90});
        assert.throws(() => parseCommand(['tv', 'seek'], -1), /seconds/);
        assert.deepEqual(parseCommand(['tv', 'quit'], ''), {kind: 'quit', key: 'tv'});
        assert.throws(() => parseCommand(['tv', 'colour'], 1), /unknown item/);
        assert.throws(() => parseCommand(['tv'], 1), /unknown item/);
    });

    test('play a url', () => {
        const plain = parseCommand(['tv', 'play'], 'https://host/stream.mp3');
        assert.equal(plain.kind, 'load');
        assert.equal(plain.media.contentId, 'https://host/stream.mp3');
        assert.equal(plain.media.contentType, 'audio/mpeg');
        assert.equal(plain.media.streamType, 'BUFFERED');
        assert.equal(plain.autoplay, true);
        const rich = parseCommand(['tv', 'play'], {
            url: 'https://host/live',
            content_type: 'audio/aac',
            title: 'Radio',
            image: 'https://host/logo.png',
            stream_type: 'live',
            autoplay: false,
        });
        assert.deepEqual(rich.media, {
            contentId: 'https://host/live',
            contentType: 'audio/aac',
            streamType: 'LIVE',
            metadata: {type: 0, metadataType: 0, title: 'Radio', images: [{url: 'https://host/logo.png'}]},
        });
        assert.equal(rich.autoplay, false);
        assert.throws(() => parseCommand(['tv', 'play'], 'ftp://x'), /http\(s\) url/);
        assert.equal(guessContentType('https://h/v.MP4?x=1'), 'video/mp4');
        assert.equal(guessContentType('https://h/stream'), 'audio/mpeg');
    });

    test('slugs', () => {
        assert.equal(slugify('Living Room'), 'living_room');
        assert.equal(slugify('Chromecast-Ultra'), 'chromecast_ultra');
        assert.equal(slugify('  '), 'device');
    });
});
