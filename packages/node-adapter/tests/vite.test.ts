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
async function fixture(source: string, shutdownTimeoutMs = 1000, watch = true) {
    const root = await mkdtemp(join(tmpdir(), 'cossack-node-vite-')); roots.push(root);
    await mkdir(join(root, 'src')); await mkdir(join(root, 'public'));
    await writeFile(join(root, 'src/index.ts'), source);
    await writeFile(join(root, 'public/asset.txt'), 'public asset');
    await writeFile(join(root, 'src/client.ts'), 'export const client = true;');
    const plugin = cossackNode({ shutdownTimeoutMs });
    const server = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [plugin], server: { port: 0, host: '127.0.0.1', watch: watch ? {} : null } });
    servers.push(server); await server.listen();
    const address = server.httpServer!.address() as { port: number };
    return { root, server, plugin, origin: `http://127.0.0.1:${address.port}` };
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
it('does not publish a stale entry when an edit arrives during asynchronous binding creation', async () => {
    const key = 'cossack-env-' + crypto.randomUUID();
    const state = { disposed: [] as string[], release: undefined as (() => void) | undefined };
    (globalThis as any)[key] = state;
    const source = (value: string, slow: boolean) => `
        export const runtime = { dispose() { globalThis[${JSON.stringify(key)}].disposed.push(${JSON.stringify(value)}); } };
        export const createEnv = () => ${slow ? `new Promise(resolve => { globalThis[${JSON.stringify(key)}].release = () => resolve({value:'stale'}); })` : `{ return {value:'fresh'}; }`};
        export const app = { fetch(_request, env) { return new Response(env.value); } };
    `;
    try {
        const {root, server, plugin, origin} = await fixture(source('stale', true), 1000, false);
        const pending = fetch(origin);
        await expect.poll(() => typeof state.release).toBe('function');
        const fresh = source('fresh', false);
        const file = join(root, 'src/index.ts'); await writeFile(file, fresh);
        const hook = (plugin.hotUpdate as any).handler.call({environment:server.environments.ssr}, {
            file, type:'update', modules:[], server, read:async () => fresh,
        });
        await Promise.resolve();
        state.release!();
        await hook;
        expect(await (await pending).text()).toBe('fresh');
        expect(state.disposed).toEqual(['stale']);
        await server.close();
        expect(state.disposed).toEqual(['stale','fresh']);
    } finally { delete (globalThis as any)[key]; }
});
it('re-evaluates the entry after a binding factory failure instead of reusing its disposed runtime', async () => {
    const key = 'cossack-env-' + crypto.randomUUID();
    (globalThis as any)[key] = 0;
    try {
        const {origin} = await fixture(`
            let disposed = false;
            export const runtime = { dispose() { disposed = true; } };
            export const createEnv = () => { if (!globalThis[${JSON.stringify(key)}]++) throw Error('binding initialization failed'); return {}; };
            export const app = { fetch() { return new Response(disposed ? 'disposed' : 'ready'); } };
        `);
        expect((await fetch(origin)).status).toBe(500);
        expect(await (await fetch(origin)).text()).toBe('ready');
    } finally { delete (globalThis as any)[key]; }
});
it('accepts a runnable SSR environment created by another Vite copy', async () => {
    // Linked packages resolve their own Vite, so the application's environment
    // is not an instance of this copy's RunnableDevEnvironment class.
    const plugin = cossackNode();
    const logger = { info() {}, warn() {}, error() {} };
    const middlewares: Array<(request: unknown, response: unknown, next: (error?: unknown) => void) => void> = [];
    const imported: string[] = [];
    const server = (environment: unknown) => ({
        config: { server: {}, mode: 'development', envDir: tmpdir(), root: tmpdir(), logger },
        environments: { ssr: environment },
        httpServer: null,
        middlewares: { use: (handler: typeof middlewares[number]) => middlewares.push(handler) },
    });
    const configure = plugin.configureServer as (server: unknown) => (() => void) | void;
    const foreign = {
        moduleGraph: { invalidateAll() {} },
        runner: {
            clearCache() {},
            async import(id: string) { imported.push(id); return { app: { fetch: () => new Response('foreign') } }; },
        },
    };
    const install = configure.call({}, server(foreign));
    expect(typeof install).toBe('function');
    (install as () => void)();
    expect(middlewares).toHaveLength(1);
    expect(() => configure.call({}, server({ moduleGraph: {} }))).toThrow('runnable Vite SSR environment');
});
