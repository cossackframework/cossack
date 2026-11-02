import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { localService, romedbDevVars, startLocalRomeDB, startLocalSites } from '../src/dev.js';
import { organizationDatabases } from '../src/index';
import { findRomeDBBinary, servesDirectories } from '../src/testing';

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

    it('passes the tokens and the sites URL on as Cloudflare variables only when they were read', () => {
        const names = ['ROMEDB_TOKEN', 'ROMEDB_SITES_URL', 'ROMEDB_SITES_TOKEN'] as const;
        const saved = names.map(name => process.env[name]);
        try {
            for (const name of names) delete process.env[name];
            expect(romedbDevVars()).toEqual({});
            process.env.ROMEDB_TOKEN = 'abc';
            expect(romedbDevVars()).toEqual({ vars: { ROMEDB_TOKEN: 'abc' } });
            process.env.ROMEDB_SITES_URL = 'http://127.0.0.1:4322/v1/organizations/x';
            process.env.ROMEDB_SITES_TOKEN = 'def';
            expect(romedbDevVars()).toEqual({ vars: { ROMEDB_TOKEN: 'abc', ROMEDB_SITES_URL: 'http://127.0.0.1:4322/v1/organizations/x', ROMEDB_SITES_TOKEN: 'def' } });
        } finally {
            names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
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

const directories = binary && servesDirectories(binary) ? describe : describe.skip;

directories('startLocalSites', () => {
    const roots: string[] = [];
    afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

    it('serves a directory for added sites, and keeps its organization across restarts', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'cossack-romedb-sites-'));
        roots.push(root);
        const port = await freePort();
        const sites = await startLocalSites({ port, root, binary, log: () => {} });
        let url = '';
        try {
            expect(sites).toMatchObject({ started: true, url: expect.stringMatching(new RegExp(`^http://127\\.0\\.0\\.1:${port}/v1/organizations/[0-9a-f-]{36}$`)) });
            url = sites!.url;
            expect(sites!.token).toBe((await readFile(path.join(root, 'storage/romedb/sites/romedb.token'), 'utf8')).trim());
            const created = await organizationDatabases({ url, token: sites!.token }).create('site-blog');
            expect(created).toMatch(/^[0-9a-f-]{36}$/);
            expect(await startLocalSites({ port, root, binary, log: () => {} })).toMatchObject({ started: false, url, token: sites!.token });
        } finally { await sites?.stop(); }
        const restarted = await startLocalSites({ port, root, binary, log: () => {} });
        try { expect(restarted).toMatchObject({ started: true, url, token: sites!.token }); }
        finally { await restarted?.stop(); }
    }, 30_000);

    it('steps aside for a romedb that cannot serve a directory', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'cossack-romedb-sites-'));
        roots.push(root);
        const old = path.join(root, 'romedb');
        await writeFile(old, '#!/bin/sh\necho "Usage: romedb serve DATABASE [--port PORT]"\n');
        await chmod(old, 0o755);
        const messages: string[] = [];
        expect(await startLocalSites({ port: await freePort(), root, binary: old, log: message => messages.push(message) })).toBeUndefined();
        expect(messages.join('\n')).toMatch(/cannot serve a directory/);
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
