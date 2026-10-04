import { afterEach, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cossackNode } from '../src/vite';

const roots: string[] = [];
const servers: ViteDevServer[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.close()));
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture(source: string, shutdownTimeoutMs = 1000) {
    const root = await mkdtemp(join(tmpdir(), 'cossack-node-vite-')); roots.push(root);
    await mkdir(join(root, 'src')); await mkdir(join(root, 'public'));
    await writeFile(join(root, 'src/index.ts'), source);
    await writeFile(join(root, 'public/asset.txt'), 'public asset');
    await writeFile(join(root, 'src/client.ts'), 'export const client = true;');
    const server = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [cossackNode({ shutdownTimeoutMs })], server: { port: 0, host: '127.0.0.1' } });
    servers.push(server); await server.listen();
    const address = server.httpServer!.address() as { port: number };
    return { root, server, origin: `http://127.0.0.1:${address.port}` };
}
it('serves application requests and cookies after Vite assets and transformed modules', async () => {
    const { origin } = await fixture(`
        export const env = { NAME: 'node' };
        export const app = { async fetch(request, env) {
            const headers = new Headers({ 'content-type': 'text/plain' });
            headers.append('set-cookie', 'first=1; Path=/'); headers.append('set-cookie', 'second=2; Path=/');
            return new Response(env.NAME + ':' + new URL(request.url).pathname + ':' + await request.text(), { headers });
        } };
    `);
    const response = await fetch(origin + '/crpc', { method: 'POST', body: 'rpc-body' });
    expect(await response.text()).toBe('node:/crpc:rpc-body');
    expect(response.headers.getSetCookie()).toEqual(['first=1; Path=/', 'second=2; Path=/']);
    expect(await (await fetch(origin + '/asset.txt')).text()).toBe('public asset');
    expect(await (await fetch(origin + '/src/client.ts')).text()).toContain('export const client = true');
    expect(await (await fetch(origin + '/@vite/client')).text()).toContain('WebSocket');
    expect(await (await fetch(origin + '/nested/page')).text()).toBe('node:/nested/page:');
});
it('reloads the entry and disposes each replaced runtime and the final runtime', async () => {
    const key = 'cossack-dev-' + crypto.randomUUID();
    const source = (value: string) => `
        export const runtime = { dispose() { globalThis[${JSON.stringify(key)}].push(${JSON.stringify(value)}); } };
        export const app = { fetch() { return new Response(${JSON.stringify(value)}); } };
    `;
    (globalThis as any)[key] = [];
    try {
        const { root, server, origin } = await fixture(source('first'));
        expect(await (await fetch(origin)).text()).toBe('first');
        await writeFile(join(root, 'src/index.ts'), source('second'));
        await expect.poll(async () => (await fetch(origin)).text()).toBe('second');
        await expect.poll(() => (globalThis as any)[key]).toEqual(['first']);
        await server.close();
        expect((globalThis as any)[key]).toEqual(['first', 'second']);
    } finally { delete (globalThis as any)[key]; }
});
it('reports entry failures and recovers after a source correction', async () => {
    const { root, origin } = await fixture(`throw new Error('entry startup failed');`);
    expect((await fetch(origin)).status).toBe(500);
    await writeFile(join(root, 'src/index.ts'), `export const app = { fetch() { return new Response('recovered'); } };`);
    await expect.poll(async () => (await fetch(origin)).text()).toBe('recovered');
});
it('bounds shutdown when application cleanup never settles', async () => {
    const { server, origin } = await fixture(`
        export const runtime = { dispose: () => new Promise(() => {}) };
        export const app = { fetch() { return new Response('ready'); } };
    `, 25);
    await fetch(origin);
    await server.close();
}, 2000);
