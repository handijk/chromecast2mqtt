import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {discoveryModel} from '../lib/hadiscovery.js';

describe('home assistant discovery', () => {
    const devices = [{key: 'living_room', name: 'Living Room', model: 'Chromecast Ultra', id: 'abc123'}];

    test('one device per cast device, available while its connection is up', () => {
        const [d] = discoveryModel({name: 'chromecast', devices});
        assert.equal(d.id, 'chromecast2mqtt_chromecast_living_room');
        assert.deepEqual(d.device, {mf: 'Google', mdl: 'Chromecast Ultra', name: 'Living Room', sn: 'abc123'});
        assert.equal(d.availability.length, 2);
        assert.equal(d.availability[1].t, 'chromecast/status/living_room/online');
        assert.match(d.availability[1].avty_tpl, /value_json\.val/);
        assert.equal(d.components.volume.p, 'number');
        assert.equal(d.components.volume.cmd_t, 'chromecast/set/living_room/volume');
        assert.equal(d.components.volume.stat_t, 'chromecast/status/living_room/volume');
        assert.equal(d.components.volume.max, 1);
        assert.equal(d.components.muted.pl_on, 'true');
        assert.equal(d.components.title.stat_t, 'chromecast/status/living_room/title');
        assert.equal(d.components.pause.p, 'button');
        assert.equal(d.components.pause.cmd_t, 'chromecast/set/living_room/player_state');
        assert.equal(d.components.pause.pl_prs, 'pause');
        assert.equal(d.components.pause.stat_t, undefined);
        assert.notEqual(d.components.play.uniq_id, d.components.stop.uniq_id);
    });

    test('plain payloads drop the templates', () => {
        const [d] = discoveryModel({name: 'chromecast', devices, jsonPayloads: false});
        assert.equal(d.components.volume.val_tpl, undefined);
        assert.match(d.availability[1].avty_tpl, /value == 'true'/);
    });
});
