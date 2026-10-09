/**
 * Home Assistant discovery: every cast device as a device of its own with the volume, mute,
 * what plays and the transport buttons. Home Assistant has no MQTT media player, so a cast
 * device is a number, a switch, sensors and buttons. Pure: devices in, device blocks out.
 */

import {availability, discoveryId, entity} from 'mqtt-interfaces-core';

const ADAPTER = 'chromecast2mqtt';

/**
 * @param {object} m
 * @param {string} m.name instance name / topic prefix
 * @param {boolean} m.jsonPayloads
 * @param {Array<{key: string, name: string, model?: string | null, id?: string | null}>} m.devices
 */
export function discoveryModel({name, jsonPayloads = true, devices = []}) {
    const base = discoveryId(ADAPTER, name);
    return devices.map((device) => {
        const id = `${base}_${device.key}`;
        const e = (item, platform, label, more = {}) =>
            entity({id, name, item: `${device.key}/${item}`, platform, label, jsonPayloads, ...more});
        const button = (label, action, icon) =>
            entity({
                id,
                name,
                item: `${device.key}/player_state`,
                platform: 'button',
                label,
                uid: `${device.key}_${action}`.replace(/\//g, '_'),
                jsonPayloads,
                command: true,
                icon,
                extra: {pl_prs: action},
            });
        return {
            id,
            device: {
                mf: 'Google',
                ...(device.model && {mdl: device.model}),
                name: device.name,
                ...(device.id && {sn: device.id}),
            },
            availability: [
                ...availability(name, 1),
                {
                    t: `${name}/status/${device.key}/online`,
                    avty_tpl: jsonPayloads
                        ? "{{ 'online' if value_json.val else 'offline' }}"
                        : "{{ 'online' if value == 'true' else 'offline' }}",
                },
            ],
            components: {
                volume: e('volume', 'number', 'Volume', {
                    command: true,
                    icon: 'mdi:volume-high',
                    extra: {min: 0, max: 1, step: 0.01, mode: 'slider'},
                }),
                muted: e('muted', 'switch', 'Mute', {
                    command: true,
                    icon: 'mdi:volume-off',
                    extra: {pl_on: 'true', pl_off: 'false', stat_on: true, stat_off: false},
                }),
                app: e('app', 'sensor', 'App', {icon: 'mdi:cast'}),
                player_state: e('player_state', 'sensor', 'Player', {icon: 'mdi:play-pause'}),
                title: e('title', 'sensor', 'Title', {icon: 'mdi:music-note'}),
                artist: e('artist', 'sensor', 'Artist', {icon: 'mdi:account-music'}),
                album: e('album', 'sensor', 'Album', {icon: 'mdi:album'}),
                play: button('Play', 'play', 'mdi:play'),
                pause: button('Pause', 'pause', 'mdi:pause'),
                stop: button('Stop', 'stop', 'mdi:stop'),
                address: e('address', 'sensor', 'Address', {category: 'diagnostic', icon: 'mdi:ip-network'}),
            },
        };
    });
}
