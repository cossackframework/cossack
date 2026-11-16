import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ISOLATE_PROTOCOL } from '../src/isolation';
import { bundleFixturePlugin, bundleModule } from './isolate-bundle';

/**
 * `@cossackframework/cms/cloudflare` in workerd: the runner reads the Worker Loader binding and
 * the application's exports, and the application's `PluginBridge` (made by `createPluginBridge`)
 * serves the plugin from a host. The host here is a stand-in that answers like one.
 */
const CLOUDFLARE = fileURLToPath(new URL('../src/cloudflare.ts', import.meta.url));

const entry = (plugin: string) => `
import { cloudflarePluginRunner, createPluginBridge, PluginTail } from ${JSON.stringify(CLOUDFLARE)};
const PLUGIN = ${JSON.stringify(plugin)};
const served = [];
const host = {
    async ready() {},
    async isolatedCall(plugin, member, args, principals) {
        served.push({ plugin, member, principals });
        if (member === 'settings.get') return args[0] === 'site' ? 'main' : 'Hello';
        if (member === 'fetch') return new Response('pong', { status: 202 });
        throw Object.assign(new Error('Plugin desk has no grant for desk/tickets.'), { code: 'CMS_FORBIDDEN' });
    },
};
export const PluginBridge = createPluginBridge((env, site) => site === 'main' ? host : null);
export { PluginTail };
export default {
    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/served') return Response.json(served);
        const runner = cloudflarePluginRunner();
        if (!runner) return Response.json({ error: { message: 'no runner' } });
        const { call, work, principals } = await request.json();
        try { return Response.json({ value: await runner.run({ name: 'desk', version: '1.0.0', code: PLUGIN, hash: 'f'.repeat(64) }, call, { site: call.site, plugin: 'desk', deadline: call.deadline, principals }, work) }); }
        catch (error) { return Response.json({ error: { message: error.message, code: error.code ?? null } }); }
    },
};
`;

describe('isolated plugins on Cloudflare', () => {
    let mf: Miniflare;
    const points = [
        { name: 'cms.resource.before-write', kind: 'filter', version: 1, timeoutMs: 2_000 },
        { name: 'cms.resource.after-commit', kind: 'action', version: 1, timeoutMs: 10_000 },
    ];
    const run = async (site: string, runSpec: unknown, options: { deadline?: number; work?: string; principals?: unknown[] } = {}) => (await (await mf.dispatchFetch('http://app/', {
        method: 'POST',
        body: JSON.stringify({ work: options.work ?? 'hook', principals: options.principals ?? [], call: { protocol: ISOLATE_PROTOCOL, site, deadline: options.deadline ?? Date.now() + 5_000, resources: ['desk/tickets'], payments: null, points, run: runSpec } }),
    })).json()) as { value?: unknown; error?: { message: string; code: string | null } };

    beforeAll(async () => {
        const script = await bundleModule(entry(await bundleFixturePlugin()));
        mf = new Miniflare({ modules: true, script, compatibilityDate: '2026-06-06', compatibilityFlags: ['nodejs_als'], workerLoaders: { LOADER: {} } });
        await mf.ready;
    }, 60_000);

    afterAll(async () => { await mf?.dispose(); });

    it('runs the plugin through the Worker Loader, and the bridge serves it from the host', async () => {
        expect(await run('main', { kind: 'filter', point: 'cms.resource.before-write', value: { title: 'ticket' }, input: { resource: 'desk/tickets' } })).toEqual({ value: { title: 'Hello ticket' } });
        const user = { kind: 'user', id: 'u1', roles: [], permissions: [] };
        expect(await run('main', { kind: 'command', name: 'ping', input: {}, principal: user }, { work: 'work', principals: [user] })).toMatchObject({ value: { status: 202, body: 'pong', site: 'main' } });
        const served = (await (await mf.dispatchFetch('http://app/served')).json()) as { member: string; principals: unknown[] }[];
        expect(served.map(entry => entry.member)).toEqual(['settings.get', 'fetch', 'settings.get']);
        expect(served[1]!.principals).toEqual([user]);
    });

    it('returns the host\'s refusal with its code, and refuses a site the host does not have', async () => {
        expect(await run('main', { kind: 'action', point: 'cms.resource.after-commit', payload: { id: 't1' } })).toEqual({ error: { message: 'Plugin desk has no grant for desk/tickets.', code: 'CMS_FORBIDDEN' } });
        expect((await run('elsewhere', { kind: 'filter', point: 'cms.resource.before-write', value: { title: 'x' }, input: {} })).error).toMatchObject({ code: 'CMS_NOT_FOUND', message: 'Site elsewhere is not available.' });
    });

    it('refuses bridge calls once the call\'s deadline has passed', async () => {
        const user = { kind: 'user', id: 'u1', roles: [], permissions: [] };
        expect((await run('main', { kind: 'command', name: 'ping', input: {}, principal: user }, { deadline: Date.now() - 1, work: 'work' })).error).toMatchObject({ code: 'CMS_UNAVAILABLE', message: 'This call to plugin desk has ended.' });
    });
});
