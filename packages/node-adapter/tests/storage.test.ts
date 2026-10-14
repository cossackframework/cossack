import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Storage } from '@cossackframework/core/storage';
import { LocalStorageProvider } from '../src/storage';

let root: string;
const bytes = (text: string) => new Blob([text]).stream();
const text = async (provider: LocalStorageProvider, key: string) => {
    const object = await provider.get(key);
    return object ? new Response(object.body).text() : null;
};
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'cossack-storage-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('persistent isolated filesystem storage', () => {
    it('streams bytes and persists detached metadata across provider recreation', async () => {
        const provider = new LocalStorageProvider({ root });
        const metadata = { owner: 'tenant-a' };
        const value = await provider.put('tenant-a/photo.txt', bytes('hello'), { size: 5, contentType: 'text/plain', customMetadata: metadata });
        metadata.owner = 'changed';
        expect(value.etag).toMatch(/^"[a-f0-9]{64}"$/);
        expect(value.uploaded).toBeInstanceOf(Date);
        const reopened = new LocalStorageProvider({ root });
        expect(await text(reopened, value.key)).toBe('hello');
        expect(await reopened.head(value.key)).toEqual(value);
        await reopened.delete(value.key);
        await reopened.delete(value.key);
        expect(await reopened.get(value.key)).toBeNull();
        expect(await reopened.head(value.key)).toBeNull();
        expect(await readdir(root)).toEqual([]);
    });
    it('keeps the old generation available to an already open reader while replacing atomically', async () => {
        const provider = new LocalStorageProvider({ root });
        await provider.put('key', bytes('old'), { size: 3 });
        const old = await provider.get('key');
        await provider.put('key', bytes('new'), { size: 3 });
        expect(await new Response(old!.body).text()).toBe('old');
        expect(await text(provider, 'key')).toBe('new');
        expect((await readdir(root)).length).toBe(2);
    });
    it('serializes competing writes across provider instances without mixed bytes or metadata', async () => {
        const a = new LocalStorageProvider({ root }); const b = new LocalStorageProvider({ root });
        await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).put('same', bytes(String(i).repeat(1000)), { size: String(i).length * 1000, customMetadata: { version: String(i) } })));
        const result = await a.get('same');
        expect(await new Response(result!.body).text()).toBe(result!.customMetadata!.version.repeat(1000));
        expect((await readdir(root)).length).toBe(2);
    });
    it('cancels blocked streams promptly, retains the previous object, and removes unpublished files', async () => {
        const provider = new LocalStorageProvider({ root }); await provider.put('key', bytes('old'), { size: 3 });
        const abort = new AbortController(); let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const body = new ReadableStream<Uint8Array>({ pull() { started(); return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
        const operation = provider.put('key', body, { size: 3, signal: abort.signal });
        await ready; abort.abort();
        await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
        expect(await text(provider, 'key')).toBe('old'); expect((await readdir(root)).length).toBe(2);
    });
    it('cancels a queued operation before the active writer finishes without letting another writer bypass it', async () => {
        const provider = new LocalStorageProvider({ root }); let finish!: () => void; let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const body = new ReadableStream<Uint8Array>({ start(controller) { finish = () => { controller.enqueue(new Uint8Array([1])); controller.close(); }; }, pull() { started(); } });
        const first = provider.put('key', body, { size: 1 }); await ready;
        const abort = new AbortController(); const queued = provider.head('key', { signal: abort.signal }); abort.abort();
        await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
        const third = provider.put('key', bytes('last'), { size: 4 }); finish(); await first; await third;
        expect(await text(provider, 'key')).toBe('last');
    });
    it('rejects size mismatch, failed source streams, malformed metadata and pre-aborted operations without publication', async () => {
        const provider = new LocalStorageProvider({ root });
        for (const size of [1, 10]) await expect(provider.put('key', bytes('hello'), { size })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_PROVIDER_FAILED' });
        await expect(provider.put('key', new ReadableStream({ start(controller) { controller.error(new Error('secret-content')); } }), { size: 1 })).rejects.toThrow('Local storage failed.');
        await expect(provider.put('key', bytes('x'), { size: 1, customMetadata: { get secret() { throw new Error('not executed'); } } })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_PROVIDER_FAILED' });
        await expect(provider.put('key', bytes('x'), { size: 1, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
        expect(await readdir(root)).toEqual([]);
    });
    it('rejects traversal and symlink roots, manifests, and data without exposing paths', async () => {
        const provider = new LocalStorageProvider({ root });
        for (const key of ['../secret', '/secret', 'a/../secret', 'a//b', 'a\\b', '%2e%2e/secret', '.', 'a/']) await expect(provider.put(key, bytes('x'), { size: 1 })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_PROVIDER_FAILED' });
        const outside = path.join(root, 'outside'); await writeFile(outside, 'secret');
        const link = path.join(root, 'link'); await symlink(root, link);
        await expect(new LocalStorageProvider({ root: path.join(link, 'nested') }).put('key', bytes('x'), { size: 1 })).rejects.toThrow('Local storage failed.');
        const prefix = createHash('sha256').update('key').digest('hex'); const manifest = path.join(root, prefix + '.json');
        await symlink(outside, manifest); await expect(provider.head('key')).rejects.toThrow('Local storage failed.'); await rm(manifest);
        await provider.put('key', bytes('x'), { size: 1 });
        const info = JSON.parse(await readFile(manifest, 'utf8')); await rm(path.join(root, info.file)); await symlink(outside, path.join(root, info.file));
        await expect(provider.get('key')).rejects.toThrow('Local storage failed.'); expect(await readFile(outside, 'utf8')).toBe('secret');
        info.file = '../outside'; await writeFile(manifest, JSON.stringify(info)); await expect(provider.delete('key')).rejects.toThrow('Local storage failed.');
    });
    it('supports zero bytes and closes cancelled download streams', async () => {
        const provider = new LocalStorageProvider({ root }); await provider.put('empty', bytes(''), { size: 0 }); expect(await text(provider, 'empty')).toBe('');
        await provider.put('large', bytes('x'.repeat(200000)), { size: 200000 });
        const abort = new AbortController(); const object = await provider.get('large', { signal: abort.signal }); const reader = object!.body.getReader();
        expect((await reader.read()).value!.length).toBeLessThan(200000); abort.abort(); await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
        const second = await provider.get('large'); await second!.body.cancel(); await provider.delete('large');
    });
});

it('composes real local persistence with authorized CRUD and expiring context-bound signed requests', async () => {
    const storage = new Storage<{ tenant: string }>({
        provider: new LocalStorageProvider({ root }),
        authorize: ({ context, key }) => key.startsWith(context.tenant + '/'),
        signing: { secret: 'a-test-signing-secret-with-at-least-32-bytes', endpoint: 'https://app.example.test/files' },
    });
    const alice = { tenant: 'alice' }; const bob = { tenant: 'bob' }; const key = 'alice/document';
    const saved = await storage.put(alice, key, bytes('private'), { size: 7, contentType: 'text/plain', customMetadata: { owner: 'alice' } });
    const snapshot = async () => Promise.all((await readdir(root)).sort().map(async name => [name, await readFile(path.join(root, name), 'hex')]));
    const original = await snapshot();
    for (const operation of [
        () => storage.put(bob, key, bytes('tampered'), { size: 8 }),
        () => storage.get(bob, key), () => storage.head(bob, key), () => storage.delete(bob, key),
        () => storage.signedUrl(bob, key, 'get', { expiresIn: 60 }),
    ]) await expect(operation()).rejects.toMatchObject({ code: 'COSSACK_STORAGE_FORBIDDEN' });
    expect(await snapshot()).toEqual(original);
    expect(await storage.head(alice, key)).toEqual(saved);
    const object = await storage.get(alice, key); expect(await new Response(object!.body).text()).toBe('private');
    const url = await storage.signedUrl(alice, key, 'get', { expiresIn: 60 });
    const response = await storage.handleSignedRequest(alice, new Request(url));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('text/plain'); expect(await response.text()).toBe('private');
    const denied = await storage.handleSignedRequest(bob, new Request(url)); expect(denied.status).toBe(403);
    const now = Date.now(); const date = vi.spyOn(Date, 'now').mockReturnValue(now + 61000);
    try { const expired = await storage.handleSignedRequest(alice, new Request(url)); expect(expired.status).toBe(410); }
    finally { date.mockRestore(); }
    expect(await snapshot()).toEqual(original);
    await storage.delete(alice, key); expect(await storage.head(alice, key)).toBeNull(); expect(await readdir(root)).toEqual([]);
});

describe('root initialization', () => {
    const initializations = () => vi.spyOn(LocalStorageProvider.prototype as unknown as { initialize(): Promise<void> }, 'initialize');
    afterEach(() => { vi.restoreAllMocks(); });

    it('initializes the root once across sequential and concurrent operations', async () => {
        const spy = initializations();
        const provider = new LocalStorageProvider({ root: path.join(root, 'nested', 'store') });
        await Promise.all(['a', 'b', 'c'].map(key => provider.put(key, bytes(key), { size: 1 })));
        await provider.head('a');
        expect(await text(provider, 'b')).toBe('b');
        await provider.delete('c');
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed initialization', async () => {
        const spy = initializations();
        const blocker = path.join(root, 'blocker');
        await writeFile(blocker, 'not a directory');
        const provider = new LocalStorageProvider({ root: path.join(blocker, 'store') });
        await expect(provider.put('key', bytes('x'), { size: 1 })).rejects.toThrow('Local storage failed.');
        await rm(blocker);
        await provider.put('key', bytes('x'), { size: 1 });
        expect(await text(provider, 'key')).toBe('x');
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('re-initializes when the storage directory has been removed', async () => {
        const spy = initializations();
        const store = path.join(root, 'store');
        const provider = new LocalStorageProvider({ root: store });
        await provider.put('key', bytes('one'), { size: 3 });
        expect(await text(provider, 'key')).toBe('one');
        await rm(store, { recursive: true });
        expect(await provider.head('key')).toBeNull();
        await provider.put('key', bytes('two'), { size: 3 });
        expect(await text(provider, 'key')).toBe('two');
        expect(spy).toHaveBeenCalledTimes(2);
    });
});
