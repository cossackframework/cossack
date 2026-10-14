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
