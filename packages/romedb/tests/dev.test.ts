import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { localService, romedbDevVars, startLocalRomeDB } from '../src/dev.js';
import { findRomeDBBinary } from '../src/testing';

describe('localService', () => {
    it('names loopback single-database URLs only', () => {
        expect(localService('http://127.0.0.1:4321')).toEqual({ origin: 'http://127.0.0.1:4321', port: 4321 });
        expect(localService('http://localhost:4400/v1/database')).toEqual({ origin: 'http://localhost:4400', port: 4400 });
        expect(localService('storage/romedb/app.romedb')).toBeUndefined();
        expect(localService(undefined)).toBeUndefined();
        expect(localService('https://cloud.romedb.com/v1/organizations/a/databases/b')).toBeUndefined();
        expect(localService('http://10.0.0.2:4321')).toBeUndefined();
        expect(localService('http://127.0.0.1:4321/v1/organizations/9d6667fd-3e4c-4f13-842f-28772c645427')).toBeUndefined();
    });

    it('passes the token on as a Cloudflare variable only when one was read', () => {
        const saved = process.env.ROMEDB_TOKEN;
        try {
            delete process.env.ROMEDB_TOKEN;
            expect(romedbDevVars()).toEqual({});
            process.env.ROMEDB_TOKEN = 'abc';
            expect(romedbDevVars()).toEqual({ vars: { ROMEDB_TOKEN: 'abc' } });
        } finally {
            if (saved === undefined) delete process.env.ROMEDB_TOKEN;
            else process.env.ROMEDB_TOKEN = saved;
        }
    });
});

const binary = findRomeDBBinary();
const live = binary ? describe : describe.skip;

live('startLocalRomeDB', () => {
    const roots: string[] = [];
    afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

    it('creates the database, reads the token file and reuses a running service', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'cossack-romedb-dev-'));
        roots.push(root);
        const url = `http://127.0.0.1:${await freePort()}`;
        const messages: string[] = [];
        const service = await startLocalRomeDB({ url, root, binary, log: message => messages.push(message) });
        try {
            expect(service?.started).toBe(true);
            expect(service!.token).toBe((await readFile(path.join(root, 'storage/romedb/token'), 'utf8')).trim());
            expect((await stat(path.join(root, 'storage/romedb/app.romedb'))).isFile()).toBe(true);
            const details = await fetch(`${url}/v1/database`, { headers: { authorization: `Bearer ${service!.token}` } });
            expect(details.status).toBe(200);
            const again = await startLocalRomeDB({ url, root, binary, log: message => messages.push(message) });
            expect(again).toMatchObject({ started: false, token: service!.token });
        } finally { await service?.stop(); }
        // The second start opens the existing file instead of creating one.
        const restarted = await startLocalRomeDB({ url, root, binary, log: message => messages.push(message) });
        try { expect(restarted?.token).toBe(service!.token); }
        finally { await restarted?.stop(); }
        expect(messages.filter(message => message.startsWith('started'))).toHaveLength(2);
    }, 30_000);

    it('leaves a service it did not start to ROMEDB_TOKEN', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'cossack-romedb-dev-'));
        const other = await mkdtemp(path.join(os.tmpdir(), 'cossack-romedb-dev-'));
        roots.push(root, other);
        const url = `http://127.0.0.1:${await freePort()}`;
        const service = await startLocalRomeDB({ url, root: other, binary, log: () => {} });
        try { expect(await startLocalRomeDB({ url, root, binary, log: () => {} })).toBeUndefined(); }
        finally { await service?.stop(); }
    }, 30_000);

    it('explains a missing executable', async () => {
        await expect(startLocalRomeDB({ url: `http://127.0.0.1:${await freePort()}`, root: os.tmpdir(), binary: '/nonexistent/romedb' }))
            .rejects.toThrow(/no romedb executable/);
    });
});

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')));
        });
    });
}
