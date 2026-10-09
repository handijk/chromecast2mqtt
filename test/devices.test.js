import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {fromService, parsePinned, Registry} from '../lib/devices.js';

describe('pinned devices', () => {
    test('name=host[:port] lists', () => {
        assert.deepEqual(parsePinned('living_room=192.168.1.20, tv=192.168.1.21:8010'), [
            {name: 'living_room', host: '192.168.1.20', port: 8009},
            {name: 'tv', host: '192.168.1.21', port: 8010},
        ]);
        assert.deepEqual(parsePinned(''), []);
        assert.throws(() => parsePinned('192.168.1.20'), /not <name>=<host>/);
        assert.throws(() => parsePinned('tv='), /no host/);
    });
});

describe('mdns services', () => {
    test('the TXT record gives name, model and id; the ipv4 address wins', () => {
        const device = fromService({
            name: 'Chromecast-Ultra-abc',
            port: 8009,
            addresses: ['fe80::1', '192.168.1.20'],
            txt: {fn: 'Chromecast Ultra', md: 'Chromecast Ultra', id: 'abc123def'},
        });
        assert.deepEqual(device, {
            id: 'abc123def',
            name: 'Chromecast Ultra',
            model: 'Chromecast Ultra',
            host: '192.168.1.20',
            port: 8009,
        });
        const bare = fromService({name: 'x', addresses: ['10.0.0.5']});
        assert.equal(bare.name, 'x');
        assert.equal(bare.model, null);
        assert.equal(bare.port, 8009);
    });
});

describe('registry', () => {
    test('keys are name slugs, a second device with the same name gets its id appended', () => {
        const r = new Registry();
        const a = r.upsert({id: 'aaa111', name: 'Kitchen', host: '10.0.0.1'});
        const b = r.upsert({id: 'bbb222', name: 'kitchen', host: '10.0.0.2'});
        assert.equal(a.added, true);
        assert.equal(a.device.key, 'kitchen');
        assert.equal(b.device.key, 'kitchen_bbb222');
        assert.deepEqual(
            r.list().map((d) => d.key),
            ['kitchen', 'kitchen_bbb222'],
        );
    });

    test('a known device keeps its key when it moves, and reports the move', () => {
        const r = new Registry();
        r.upsert({id: 'aaa111', name: 'Kitchen', host: '10.0.0.1'});
        const same = r.upsert({id: 'aaa111', name: 'Kitchen', host: '10.0.0.1'});
        assert.deepEqual([same.added, same.changed], [false, false]);
        const moved = r.upsert({id: 'aaa111', name: 'Kitchen', host: '10.0.0.9'});
        assert.deepEqual(
            [moved.added, moved.changed, moved.device.key, moved.device.host],
            [false, true, 'kitchen', '10.0.0.9'],
        );
        const renamed = r.upsert({id: 'aaa111', name: 'Cuisine', host: '10.0.0.9'});
        assert.equal(renamed.changed, true);
        assert.equal(renamed.device.key, 'kitchen', 'the key is the topic: it stays');
        assert.equal(renamed.device.name, 'Cuisine');
    });

    test('pinned devices have no id and are found by name; id mode uses the id', () => {
        const r = new Registry();
        r.upsert({id: null, name: 'tv', host: '10.0.0.3'});
        assert.equal(r.upsert({id: null, name: 'tv', host: '10.0.0.3'}).added, false);
        const byId = new Registry({mode: 'id'});
        assert.equal(byId.upsert({id: 'ABC-123', name: 'Kitchen', host: '10.0.0.1'}).device.key, 'abc_123');
    });
});
