import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import fsModule from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createStaticAssets, serveStatic } from '../src/static-serve.js';

const temporaryDirectories: string[] = [];

function fixture(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-static-'));
    temporaryDirectories.push(directory);
    fs.mkdirSync(path.join(directory, 'assets'));
    fs.writeFileSync(path.join(directory, 'assets', 'entry.abc12345.js'), 'export const ready = true;');
    fs.writeFileSync(path.join(directory, 'assets', 'style.abc12345.css'), 'body { color: red; }');
    fs.writeFileSync(path.join(directory, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(directory, 'site.webmanifest'), '{}');
    fs.writeFileSync(path.join(directory, 'index.html'), 'static index');
    return directory;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('serveStatic', () => {
    it('provides the SSR ASSETS interface for manifests, CSS, and missing files', async () => {
        const root = fixture();
        const manifest = { 'src/client/entry-client.ts': {
            file: 'assets/entry.abc12345.js', css: ['assets/style.abc12345.css'],
        } };
        fs.writeFileSync(path.join(root, 'cossack-manifest.json'), JSON.stringify(manifest));
        const assets = createStaticAssets({ root, index: false });
        const response = await assets.fetch(new Request('https://assets.local/cossack-manifest.json'));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(manifest);
        const css = await assets.fetch(new Request('https://assets.local/assets/style.abc12345.css'));
        expect(await css.text()).toBe('body { color: red; }');
        expect((await assets.fetch(new Request('https://assets.local/missing.css'))).status).toBe(404);
        expect((await assets.fetch(new Request('https://assets.local/'))).status).toBe(404);
    });

    it('keeps filesystem containment checks on the ASSETS interface', async () => {
        const root = fixture();
        const outside = fixture();
        fs.symlinkSync(path.join(outside, 'logo.svg'), path.join(root, 'leak.svg'));
        const assets = createStaticAssets({ root, index: false });
        expect((await assets.fetch(new Request('https://assets.local/leak.svg'))).status).toBe(404);
    });

    it('serves generated and public client files with MIME and cache headers', async () => {
        const root = fixture();
        const app = new Hono();
        app.use('*', serveStatic({
            root,
            index: false,
            cacheControl: (_filePath, urlPath) => urlPath.startsWith('/assets/') && /\.[a-zA-Z0-9_-]{8,}\.[^/]+$/.test(urlPath)
                ? 'public, max-age=31536000, immutable'
                : 'public, max-age=0, must-revalidate',
        }));
        app.get('*', (c) => c.text('framework response'));

        const javascript = await app.request('/assets/entry.abc12345.js');
        expect(javascript.status).toBe(200);
        expect(javascript.headers.get('content-type')).toBe('application/javascript');
        expect(javascript.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

        const stylesheet = await app.request('/assets/style.abc12345.css');
        expect(stylesheet.status).toBe(200);
        expect(stylesheet.headers.get('content-type')).toBe('text/css');

        const publicFile = await app.request('/logo.svg');
        expect(publicFile.status).toBe(200);
        expect(publicFile.headers.get('content-type')).toBe('image/svg+xml');
        expect(publicFile.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');

        const manifest = await app.request('/site.webmanifest');
        expect(manifest.headers.get('content-type')).toBe('application/manifest+json');
    });

    it('blocks symlink files, directories, and indexes that escape the public root', async () => {
        const root = fixture();
        const outside = fixture();
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'private credential');
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
        fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');
        fs.mkdirSync(path.join(root, 'index-leak'));
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'index-leak', 'index.html'));
        fs.symlinkSync(path.join(root, 'logo.svg'), path.join(root, 'safe.svg'));
        const app = new Hono();
        app.use('*', serveStatic({ root }));
        for (const url of ['/leak.txt', '/escape/secret.txt', '/escape/', '/index-leak/']) {
            expect((await app.request(url)).status).toBe(404);
        }
        expect((await app.request('/safe.svg')).status).toBe(200);
        expect(await (await app.request('/logo.svg', { method: 'HEAD' })).text()).toBe('');
    });

    it('does not replace the framework root route when directory indexes are disabled', async () => {
        const app = new Hono();
        app.use('*', serveStatic({ root: fixture(), index: false }));
        app.get('/', (c) => c.text('SSR'));

        const response = await app.request('/');
        expect(await response.text()).toBe('SSR');
    });
    it('matches the prefix only on a path-segment boundary, with or without a trailing slash', async () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, '-x.txt'), 'outside the prefix');
        for (const prefix of ['/static', '/static/']) {
            const app = new Hono();
            app.use('*', serveStatic({ root, prefix }));
            app.get('*', (c) => c.text('framework response'));
            expect(await (await app.request('/static-x.txt')).text()).toBe('framework response');
            expect(await (await app.request('/staticlogo.svg')).text()).toBe('framework response');
            expect(await (await app.request('/static/logo.svg')).text()).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
            expect(await (await app.request('/static/assets/entry.abc12345.js')).text()).toBe('export const ready = true;');
            expect(await (await app.request('/static')).text()).toBe('static index');
            expect(await (await app.request('/static/')).text()).toBe('static index');
        }
    });

    it('sets Content-Length on GET and HEAD and streams binary files intact', async () => {
        const root = fixture();
        const bytes = new Uint8Array(300 * 1024).map((_value, index) => (index * 31) % 256);
        fs.writeFileSync(path.join(root, 'blob.bin'), bytes);
        const app = new Hono();
        app.use('*', serveStatic({ root }));
        const response = await app.request('/blob.bin');
        expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
        const head = await app.request('/blob.bin', { method: 'HEAD' });
        expect(head.status).toBe(200);
        expect(head.headers.get('content-length')).toBe(String(bytes.byteLength));
        expect(head.headers.get('content-type')).toBe('application/octet-stream');
        expect(await head.text()).toBe('');
        fs.writeFileSync(path.join(root, 'empty.txt'), '');
        const empty = await app.request('/empty.txt');
        expect(empty.status).toBe(200);
        expect(empty.headers.get('content-length')).toBe('0');
        expect(await empty.text()).toBe('');
    });

    it('neither blocks on synchronous existence checks nor buffers whole files', async () => {
        const root = fixture();
        const exists = vi.spyOn(fsModule, 'existsSync');
        const readFile = vi.spyOn(fsModule.promises, 'readFile');
        syncBuiltinESMExports();
        try {
            const app = new Hono();
            app.use('*', serveStatic({ root }));
            expect(await (await app.request('/logo.svg')).text()).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
            expect(await (await app.request('/assets/')).status).toBe(404);
            expect(await (await app.request('/missing')).status).toBe(404);
            expect(exists).not.toHaveBeenCalled();
            expect(readFile).not.toHaveBeenCalled();
        } finally {
            exists.mockRestore();
            readFile.mockRestore();
            syncBuiltinESMExports();
        }
    });

    it('sends a weak ETag and answers a matching If-None-Match with an empty 304', async () => {
        const root = fixture();
        const file = path.join(root, 'logo.svg');
        const app = new Hono();
        app.use('*', serveStatic({ root, cacheControl: 'public, max-age=0, must-revalidate' }));
        const stats = fs.statSync(file);
        const expected = `W/"${Math.floor(stats.mtimeMs).toString(16)}-${stats.size.toString(16)}"`;
        const first = await app.request('/logo.svg');
        expect(first.headers.get('etag')).toBe(expected);
        expect((await app.request('/logo.svg', { method: 'HEAD' })).headers.get('etag')).toBe(expected);

        for (const condition of [expected, expected.slice(2), `"other", ${expected}`, '*']) {
            const cached = await app.request('/logo.svg', { headers: { 'if-none-match': condition } });
            expect(cached.status).toBe(304);
            expect(cached.headers.get('etag')).toBe(expected);
            expect(cached.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
            expect(await cached.text()).toBe('');
        }
        const stale = await app.request('/logo.svg', { headers: { 'if-none-match': 'W/"0-0"' } });
        expect(stale.status).toBe(200);
        expect(await stale.text()).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');

        fs.writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg" width="2"/>');
        fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
        const changed = await app.request('/logo.svg', { headers: { 'if-none-match': expected } });
        expect(changed.status).toBe(200);
        expect(changed.headers.get('etag')).not.toBe(expected);
    });
});

describe('serveStatic conditional and range requests', () => {
    const lastModifiedOf = (file: string) => new Date(Math.floor(fs.statSync(file).mtimeMs / 1000) * 1000).toUTCString();
    function rangeFixture() {
        const root = fixture();
        const bytes = new Uint8Array(1000).map((_value, index) => index % 251);
        const file = path.join(root, 'data.bin');
        fs.writeFileSync(file, bytes);
        // Last-Modified is a strong validator only when it is at least one second old.
        const past = new Date(Date.now() - 60_000);
        fs.utimesSync(file, past, past);
        const app = new Hono();
        app.use('*', serveStatic({ root, cacheControl: 'public, max-age=0, must-revalidate' }));
        app.all('*', (c) => c.text('framework response', 404));
        return { root, file, bytes, app };
    }

    it('sends Last-Modified and answers If-Modified-Since with an empty 304', async () => {
        const { file, app } = rangeFixture();
        const lastModified = lastModifiedOf(file);
        const first = await app.request('/data.bin');
        expect(first.headers.get('last-modified')).toBe(lastModified);
        const etag = first.headers.get('etag')!;

        for (const method of ['GET', 'HEAD']) {
            const cached = await app.request('/data.bin', { method, headers: { 'if-modified-since': lastModified } });
            expect(cached.status).toBe(304);
            expect(cached.headers.get('etag')).toBe(etag);
            expect(cached.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
            expect(await cached.text()).toBe('');
        }
        const later = new Date(Date.parse(lastModified) + 1000).toUTCString();
        expect((await app.request('/data.bin', { headers: { 'if-modified-since': later } })).status).toBe(304);
        const earlier = new Date(Date.parse(lastModified) - 1000).toUTCString();
        for (const value of [earlier, 'not a date', new Date(Date.now() + 86_400_000).toUTCString()]) {
            const fresh = await app.request('/data.bin', { headers: { 'if-modified-since': value } });
            expect(fresh.status).toBe(200);
            expect((await fresh.arrayBuffer()).byteLength).toBe(1000);
        }
        // If-None-Match takes precedence over If-Modified-Since.
        const mismatch = await app.request('/data.bin', { headers: { 'if-none-match': 'W/"0-0"', 'if-modified-since': lastModified } });
        expect(mismatch.status).toBe(200);
        await mismatch.arrayBuffer();
        expect((await app.request('/data.bin', { headers: { 'if-none-match': etag, 'if-modified-since': earlier } })).status).toBe(304);
    });

    it('serves one byte range with 206, Content-Range and the advertised length', async () => {
        const { bytes, app } = rangeFixture();
        const full = await app.request('/data.bin');
        expect(full.status).toBe(200);
        expect(full.headers.get('accept-ranges')).toBe('bytes');
        expect(full.headers.get('content-range')).toBeNull();
        await full.arrayBuffer();

        for (const [header, start, end] of [
            ['bytes=0-9', 0, 9], ['bytes=990-', 990, 999], ['bytes=-5', 995, 999], ['bytes=995-5000', 995, 999],
            ['bytes=0-0', 0, 0], ['bytes=-5000', 0, 999], [' Bytes = 10 - 19 ', 10, 19],
        ] as const) {
            const response = await app.request('/data.bin', { headers: { range: header } });
            expect(response.status, header).toBe(206);
            expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/1000`);
            expect(response.headers.get('content-length')).toBe(String(end - start + 1));
            expect(response.headers.get('content-type')).toBe('application/octet-stream');
            expect(response.headers.get('accept-ranges')).toBe('bytes');
            expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
            expect(response.headers.get('etag')).toBe(full.headers.get('etag'));
            expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(start, end + 1));
        }
    });

    it('answers unsatisfiable ranges with 416 and ignores malformed or multiple ranges', async () => {
        const { root, app } = rangeFixture();
        for (const header of ['bytes=1000-', 'bytes=5000-6000', 'bytes=-0']) {
            const response = await app.request('/data.bin', { headers: { range: header } });
            expect(response.status, header).toBe(416);
            expect(response.headers.get('content-range')).toBe('bytes */1000');
            expect(response.headers.get('cache-control')).toBeNull();
            expect(await response.text()).toBe('');
        }
        fs.writeFileSync(path.join(root, 'empty.txt'), '');
        const empty = await app.request('/empty.txt', { headers: { range: 'bytes=0-' } });
        expect(empty.status).toBe(416);
        expect(empty.headers.get('content-range')).toBe('bytes */0');

        for (const header of ['bytes=0-1,3-4', 'items=0-9', 'bytes=9-1', 'bytes=-', 'bytes=abc', 'bytes 0-9']) {
            const response = await app.request('/data.bin', { headers: { range: header } });
            expect(response.status, header).toBe(200);
            expect(response.headers.get('content-length')).toBe('1000');
            expect((await response.arrayBuffer()).byteLength).toBe(1000);
        }
    });

    it('honours If-Range only for an unchanged strong Last-Modified date', async () => {
        const { file, app } = rangeFixture();
        const lastModified = lastModifiedOf(file);
        const etag = (await app.request('/data.bin', { method: 'HEAD' })).headers.get('etag')!;
        const partial = await app.request('/data.bin', { headers: { range: 'bytes=0-9', 'if-range': lastModified } });
        expect(partial.status).toBe(206);
        expect((await partial.arrayBuffer()).byteLength).toBe(10);
        // A weak ETag never matches strongly, and a different date means the file changed.
        for (const value of [etag, etag.slice(2), new Date(Date.parse(lastModified) - 1000).toUTCString()]) {
            const full = await app.request('/data.bin', { headers: { range: 'bytes=0-9', 'if-range': value } });
            expect(full.status, value).toBe(200);
            expect((await full.arrayBuffer()).byteLength).toBe(1000);
        }
        // A modification time within the last second is not a strong validator.
        fs.utimesSync(file, new Date(), new Date());
        const recent = await app.request('/data.bin', { headers: { range: 'bytes=0-9', 'if-range': lastModifiedOf(file) } });
        expect(recent.status).toBe(200);
        await recent.arrayBuffer();
    });

    it('ignores Range on HEAD and describes the whole file without a body', async () => {
        const { app } = rangeFixture();
        const head = await app.request('/data.bin', { method: 'HEAD', headers: { range: 'bytes=0-9' } });
        expect(head.status).toBe(200);
        expect(head.headers.get('content-length')).toBe('1000');
        expect(head.headers.get('content-range')).toBeNull();
        expect(head.headers.get('accept-ranges')).toBe('bytes');
        expect(head.headers.get('last-modified')).not.toBeNull();
        expect(await head.text()).toBe('');
    });

    it('keeps traversal and symlink containment for range and conditional requests', async () => {
        const { root, app } = rangeFixture();
        const outside = fixture();
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'private credential');
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
        const prefixed = new Hono();
        prefixed.use('*', serveStatic({ root: path.join(root, 'assets'), prefix: '/static' }));
        prefixed.all('*', (c) => c.text('framework response', 404));
        const headers = { range: 'bytes=0-3', 'if-modified-since': new Date(0).toUTCString() };
        for (const [server, url] of [[app, '/leak.txt'], [prefixed, '/static/%2e%2e/data.bin'], [prefixed, '/static/..%2fdata.bin'], [prefixed, '/static/%2e%2e%2f..%2fetc/passwd']] as const) {
            const response = await server.request(url, { headers });
            expect(response.status, url).toBe(404);
            expect(await response.text()).toBe('framework response');
        }
    });

    it('streams large files and ranges in bounded chunks', async () => {
        const root = fixture();
        const size = 64 * 1024 * 1024;
        const file = path.join(root, 'large.bin');
        // A sparse file: creating it does not write 64 MiB.
        fs.writeFileSync(file, 'head');
        fs.truncateSync(file, size);
        const app = new Hono();
        app.use('*', serveStatic({ root }));
        const response = await app.request('/large.bin');
        expect(response.headers.get('content-length')).toBe(String(size));
        const reader = response.body!.getReader();
        const first = await reader.read();
        expect(first.done).toBe(false);
        expect(first.value!.byteLength).toBeLessThanOrEqual(1024 * 1024);
        await reader.cancel();

        const tail = await app.request('/large.bin', { headers: { range: `bytes=${size - 8}-` } });
        expect(tail.status).toBe(206);
        expect(tail.headers.get('content-range')).toBe(`bytes ${size - 8}-${size - 1}/${size}`);
        expect((await tail.arrayBuffer()).byteLength).toBe(8);
        const start = await app.request('/large.bin', { headers: { range: 'bytes=0-3' } });
        expect(await start.text()).toBe('head');
    });
});
