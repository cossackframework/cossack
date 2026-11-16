// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Storage, validateStorageKey } from '../src/storage/runtime';
import type { StorageProvider, StorageObject, StorageMetadata } from '../src/storage/contracts';
function fixture() {
    const objects = new Map<string, { data: Uint8Array<ArrayBuffer>; metadata: StorageMetadata }>();
    const provider: StorageProvider = {
        name: 'test-memory',
        put: vi.fn(async (key, body, options) => { const data = new Uint8Array(await new Response(body).arrayBuffer()); const record = { data, metadata: { key, size: data.length, contentType: options.contentType, customMetadata: options.customMetadata } }; objects.set(key, record); return record.metadata; }),
        get: vi.fn(async key => { const record = objects.get(key); return record ? { ...record.metadata, body: new Blob([record.data]).stream() } as StorageObject : null; }),
        head: vi.fn(async key => objects.get(key)?.metadata ?? null), delete: vi.fn(async key => { objects.delete(key); }),
    };
    const storage = new Storage<string>({ provider, authorize: ({ context, key }) => key.startsWith(context + '/'), signing: { secret: 'fixture-secret-0123456789abcdef0123456789', endpoint: 'https://app.test/files' }, maxBytes: 20, contentTypes: ['text/plain'] });
    const body = (value = 'hello') => new Blob([value]).stream();
    return { storage, provider, body };
}
afterEach(() => vi.useRealTimers());
it('authorizes every CRUD operation before provider access and preserves metadata/progress', async () => {
    const { storage, provider, body } = fixture(); const progress = vi.fn();
    expect(await storage.put('a', 'a/file', body(), { size: 5, contentType: 'text/plain', customMetadata: { label: 'draft' }, onProgress: progress })).toMatchObject({ size: 5, customMetadata: { label: 'draft' } });
    expect(progress).toHaveBeenCalledWith({ transferred: 5, total: 5 });
    const object = await storage.get('a', 'a/file', { onProgress: progress }); expect(await new Response(object!.body).text()).toBe('hello'); expect(await storage.head('a', 'a/file')).toMatchObject({ size: 5 });
    for (const op of ['get', 'head', 'delete'] as const) await expect(storage[op]('b', 'a/file')).rejects.toMatchObject({ code: 'COSSACK_STORAGE_FORBIDDEN' });
    await expect(storage.put('b', 'a/file', body(), { size: 5, contentType: 'text/plain' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_FORBIDDEN' });
    expect(provider.put).toHaveBeenCalledTimes(1); expect(provider.get).toHaveBeenCalledTimes(1); expect(provider.head).toHaveBeenCalledTimes(1); expect(provider.delete).not.toHaveBeenCalled();
    await storage.delete('a', 'a/file'); expect(await storage.get('a', 'a/file')).toBeNull();
});
it.each(['', '/absolute', 'a/../b', 'a/./b', 'a//b', 'a\\b', 'a\0b'])('rejects unsafe key %j', key => { expect(() => validateStorageKey(key)).toThrow(); });
it.each([4, 6])('rejects declared byte mismatch %i without publishing', async size => {
    const { storage, body } = fixture(); await expect(storage.put('a', 'a/file', body(), { size, contentType: 'text/plain' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_SIZE_MISMATCH' }); expect(await storage.head('a', 'a/file')).toBeNull();
});
it('validates size/type/metadata before dispatch without executing accessors', async () => {
    const { storage, provider, body } = fixture();
    await expect(storage.put('a', 'a/file', body(), { size: 21, contentType: 'text/plain' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_SIZE_INVALID' });
    await expect(storage.put('a', 'a/file', body(), { size: 5, contentType: 'text/html' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_TYPE_INVALID' });
    const getter = vi.fn(); await expect(storage.put('a', 'a/file', body(), { size: 5, contentType: 'text/plain', customMetadata: Object.defineProperty({}, 'label', { get: getter }) })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_METADATA_INVALID' });
    expect(getter).not.toHaveBeenCalled(); expect(provider.put).not.toHaveBeenCalled();
});
it('cancels a parked stream and does not publish its partial body', async () => {
    const { storage } = fixture(); const controller = new AbortController(); const sourceCancelled = vi.fn(() => new Promise<void>(() => {}));
    const pending = storage.put('a', 'a/file', new ReadableStream({ cancel: sourceCancelled }), { size: 5, contentType: 'text/plain', signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'COSSACK_STORAGE_ABORTED' }); await vi.waitFor(() => expect(sourceCancelled).not.toHaveBeenCalled()); controller.abort('private reason'); await rejected;
    expect(sourceCancelled).toHaveBeenCalledOnce(); expect(await storage.head('a', 'a/file')).toBeNull();
});
it('signs exact key/method/endpoint and reauthorizes redemption without trusting the URL holder', async () => {
    const { storage, body } = fixture(); await storage.put('a', 'a/file', body(), { size: 5, contentType: 'text/plain' });
    const url = await storage.signedUrl('a', 'a/file', 'get', { expiresIn: 30 });
    expect(await (await storage.handleSignedRequest('a', new Request(url))).text()).toBe('hello');
    expect((await storage.handleSignedRequest('b', new Request(url))).status).toBe(403);
    expect((await storage.handleSignedRequest('a', new Request(url, { method: 'PUT', body: 'bad' }))).status).toBe(405);
    expect((await storage.handleSignedRequest('a', new Request(url.replace('/files?', '/other?')))).status).toBe(400);
    expect((await storage.handleSignedRequest('a', new Request(url + 'tamper'))).status).toBe(400);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 31000); expect((await storage.handleSignedRequest('a', new Request(url))).status).toBe(410);
});
it('streams a signed upload with enforced metadata/byte count', async () => {
    const { storage } = fixture(); const url = await storage.signedUrl('a', 'a/file', 'put', { expiresIn: 20, size: 5, contentType: 'text/plain', customMetadata: { label: 'signed' } });
    expect((await storage.handleSignedRequest('a', new Request(url, { method: 'PUT', body: 'hello' }))).status).toBe(201);
    expect(await storage.head('a', 'a/file')).toMatchObject({ size: 5, customMetadata: { label: 'signed' } });
});

it('does not serialize the authorizer, provider or signing secret', () => {
    const { storage } = fixture(); expect(JSON.stringify(storage)).not.toContain('fixture-secret');
});

it('reports an invalid signing endpoint without exposing configuration values', () => {
    const { provider } = fixture();
    expect(() => new Storage({ provider, authorize: () => true, signing: { secret: 'PRIVATE_SECRET', endpoint: 'PRIVATE_ENDPOINT' } }))
        .toThrow(expect.objectContaining({ code: 'COSSACK_STORAGE_CONFIG_INVALID', message: expect.not.stringContaining('PRIVATE_') }));
});

it('redacts raw provider and source failures, including forged public error codes', async () => {
    const { storage, provider, body } = fixture();
    vi.mocked(provider.head).mockRejectedValueOnce(new Error('PRIVATE_CREDENTIAL'));
    await expect(storage.head('a', 'a/file')).rejects.toMatchObject({ code: 'COSSACK_STORAGE_PROVIDER_FAILED', message: expect.not.stringContaining('PRIVATE_CREDENTIAL') });
    const source = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('PRIVATE_SOURCE')); } });
    await expect(storage.put('a', 'a/file', source, { size: 5, contentType: 'text/plain' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_TRANSFER_FAILED', message: expect.not.stringContaining('PRIVATE_SOURCE') });
});

it('presigns an upload through the provider when it can sign, and through the endpoint otherwise', async () => {
    const { storage, provider } = fixture();
    const fallback = await storage.presignedUpload('a', 'a/file', { expiresIn: 20, size: 5, contentType: 'text/plain' });
    expect(fallback).toMatchObject({ method: 'PUT', headers: {} });
    expect(fallback.url.startsWith('https://app.test/files?access=')).toBe(true);
    provider.presign = vi.fn(async (key, options) => ({ url: `https://bucket.test/${key}?signed`, method: 'PUT' as const, headers: { 'content-type': options.contentType! } }));
    expect(await storage.presignedUpload('a', 'a/file', { expiresIn: 20, size: 5, contentType: 'text/plain' })).toEqual({ url: 'https://bucket.test/a/file?signed', method: 'PUT', headers: { 'content-type': 'text/plain' } });
    expect(provider.presign).toHaveBeenCalledWith('a/file', { size: 5, contentType: 'text/plain', customMetadata: undefined, expiresIn: 20 });
    // The facade's checks come first: authorization, the byte limit and the permitted types.
    await expect(storage.presignedUpload('b', 'a/file', { expiresIn: 20, size: 5, contentType: 'text/plain' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_FORBIDDEN' });
    await expect(storage.presignedUpload('a', 'a/file', { expiresIn: 20, size: 50, contentType: 'text/plain' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_SIZE_INVALID' });
    await expect(storage.presignedUpload('a', 'a/file', { expiresIn: 20, size: 5, contentType: 'image/png' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_TYPE_INVALID' });
    expect(provider.presign).toHaveBeenCalledTimes(1);
});
