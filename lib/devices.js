/**
 * Which devices there are: pinned by `--devices`, or found with mdns (_googlecast._tcp, the TXT
 * record carries the friendly name `fn`, the model `md` and the cast id `id`). The registry gives
 * every device its topic level: the friendly name as a slug, or the id; two devices with the same
 * name get the start of their id appended, so a rename never silently takes over another's topic.
 */

import {slugify} from './items.js';

/** `name=host[:port],name2=host2` → [{name, host, port}] */
export function parsePinned(spec) {
    if (!spec) {
        return [];
    }
    return String(spec)
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((entry) => {
            const eq = entry.indexOf('=');
            if (eq <= 0) {
                throw new Error(`--devices: "${entry}" is not <name>=<host>`);
            }
            const name = entry.slice(0, eq);
            const [host, port] = entry.slice(eq + 1).split(':');
            if (!host) {
                throw new Error(`--devices: "${entry}" has no host`);
            }
            return {name, host, port: port ? Number(port) : 8009};
        });
}

/** A device as the registry describes it, from an mdns service (bonjour-service's shape). */
export function fromService(service) {
    const txt = service.txt || {};
    const addresses = Array.isArray(service.addresses) ? service.addresses : [];
    const host =
        addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ||
        addresses[0] ||
        (service.referer && service.referer.address);
    return {
        id: txt.id || null,
        name: txt.fn || service.name || host,
        model: txt.md || null,
        host,
        port: service.port || 8009,
    };
}

export class Registry {
    /** @param {{mode?: 'name' | 'id'}} [options] */
    constructor({mode = 'name'} = {}) {
        this.mode = mode;
        this.devices = new Map(); // key → {key, id, name, model, host, port}
    }

    keyFor({id, name}) {
        if (this.mode === 'id' && id) {
            return slugify(id);
        }
        const slug = slugify(name);
        const other = [...this.devices.values()].find((d) => d.key === slug && d.id !== id);
        if (other && id) {
            return `${slug}_${slugify(id).slice(0, 6)}`;
        }
        return slug;
    }

    /** The device for an id or a name: the same key as before when it is known. */
    find({id, name}) {
        for (const d of this.devices.values()) {
            if ((id && d.id === id) || (!id && d.name === name)) {
                return d;
            }
        }
        return null;
    }

    /**
     * Add or update a device. Returns {device, added, changed}: `changed` when the host or the name
     * moved (the connection must follow), `added` when it is new.
     */
    upsert(info) {
        const known = this.find(info);
        if (!known) {
            const key = this.keyFor(info);
            const device = {
                key,
                id: info.id || null,
                name: info.name,
                model: info.model || null,
                host: info.host,
                port: info.port || 8009,
            };
            this.devices.set(key, device);
            return {device, added: true, changed: false};
        }
        const changed = known.host !== info.host || known.port !== (info.port || 8009) || known.name !== info.name;
        Object.assign(known, {
            name: info.name,
            model: info.model || known.model,
            host: info.host,
            port: info.port || 8009,
            id: info.id || known.id,
        });
        return {device: known, added: false, changed};
    }

    list() {
        return [...this.devices.values()];
    }
}
