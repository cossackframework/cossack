import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { serveStatic } from '../src/static-serve.js';

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

    it('does not replace the framework root route when directory indexes are disabled', async () => {
        const app = new Hono();
        app.use('*', serveStatic({ root: fixture(), index: false }));
        app.get('/', (c) => c.text('SSR'));

        const response = await app.request('/');
        expect(await response.text()).toBe('SSR');
    });
});
