/**
 * Databases created and deleted by name, for applications with one database per tenant: a
 * RomeDB Cloud organization, or `romedb serve --directory`, which has the same routes. Web APIs
 * only. `fileDatabases` in `@cossackframework/romedb/node` keeps them as files instead.
 */

export interface DatabaseDirectory {
    /**
     * Create an empty database and return its ID. A name already used returns that database, so
     * an interrupted creation can run again. Names are 1 to 48 of `a-z`, `0-9` and `-`, from a letter.
     */
    create(name: string): Promise<string>;
    /** Delete the database and all of its data. An unknown ID is already deleted. */
    delete(id: string): Promise<void>;
    /** The database's URL, for `createRomeDB`. */
    url(id: string): string;
}

const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

/** A RomeDB Cloud organization URL, or the organization URL `romedb serve --directory` prints, with a key that may manage and query. */
export function organizationDatabases(options: { url: string; token: string; fetch?: typeof globalThis.fetch }): DatabaseDirectory {
    const base = options.url.replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]+\/v1\/organizations\/[^/]+$/.test(base)) throw new TypeError('Use an organization URL: https://…/v1/organizations/<id>.');
    if (!options.token) throw new TypeError('An organization URL needs a key with the manage and query scopes.');
    const send = (path: string, init: RequestInit = {}) => (options.fetch ?? globalThis.fetch)(`${base}${path}`, {
        ...init, redirect: 'manual', headers: { authorization: `Bearer ${options.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
    return {
        async create(name) {
            if (!NAME.test(name)) throw new TypeError('Database names are 1 to 48 of a-z, 0-9 and -, starting with a letter.');
            const response = await send('/databases', { method: 'POST', body: JSON.stringify({ name }) });
            const body = await response.json().catch(() => ({})) as { id?: unknown; error?: unknown };
            if (!response.ok || typeof body.id !== 'string' || !ID.test(body.id)) throw new Error(`RomeDB could not create database ${name} (${response.status}${typeof body.error === 'string' ? `: ${body.error}` : ''}).`);
            return body.id;
        },
        async delete(id) {
            if (!ID.test(id)) throw new TypeError('Invalid database ID.');
            const response = await send(`/databases/${id}`, { method: 'DELETE' });
            await response.body?.cancel();
            if (!response.ok && response.status !== 404) throw new Error(`RomeDB could not delete database ${id} (${response.status}).`);
        },
        url: id => `${base}/databases/${id}`,
    };
}
