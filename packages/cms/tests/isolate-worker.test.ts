import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { rolldown } from 'rolldown';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ISOLATE_PROTOCOL } from '../src/isolation';

/**
 * `@cossackframework/cms/isolate` in a Worker of its own: a plugin bundled with it, loaded
 * through the Worker Loader and called with a bridge stub, as the host will (step 4).
 */

const ISOLATE = fileURLToPath(new URL('../src/isolate.ts', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/isolated-desk/', import.meta.url));

const LOADER = (code: string) => `
import { WorkerEntrypoint } from 'cloudflare:workers';
const PLUGIN = ${JSON.stringify(code)};
export class Bridge extends WorkerEntrypoint {
    async call(member, args) {
        if (Date.now() > this.ctx.props.deadline) throw new Error('This call has ended.');
        switch (member) {
            case 'settings.get': return args[0] === 'site' ? this.ctx.props.site : 'Hello';
            case 'fetch': { const request = args[0]; return new Response(request.method + ' ' + request.url + ' ' + await request.text(), { status: 201 }); }
            case 'resource.get': throw Object.assign(new Error('Plugin desk has no grant for desk/tickets.'), { code: 'CMS_FORBIDDEN' });
        }
        throw new Error('unexpected ' + member);
    }
}
export default {
    async fetch(request, env, ctx) {
        const call = await request.json();
        const plugin = env.LOADER.get('desk@1.0.0', () => ({ compatibilityDate: '2026-06-06', compatibilityFlags: ['nodejs_als'], mainModule: 'plugin.js', modules: { 'plugin.js': PLUGIN }, env: {}, globalOutbound: null })).getEntrypoint();
        const bridge = ctx.exports.Bridge({ props: { site: call.site, deadline: call.deadline } });
        try { return Response.json({ value: await plugin.run(call, bridge) }); }
        catch (error) { return Response.json({ error: { message: error.message, code: error.code ?? null } }); }
    },
};
`;

describe('an isolated plugin in its own Worker', () => {
    let mf: Miniflare;
    const run = async (site: string, runSpec: unknown, deadline = Date.now() + 5_000) => (await (await mf.dispatchFetch('http://loader/', {
        method: 'POST',
        body: JSON.stringify({ protocol: ISOLATE_PROTOCOL, site, deadline, resources: ['desk/tickets'], payments: null, run: runSpec, points: [
            { name: 'cms.resource.before-write', kind: 'filter', version: 1, timeoutMs: 2_000 },
            { name: 'cms.resource.after-commit', kind: 'action', version: 1, timeoutMs: 10_000 },
        ] }),
    })).json()) as { value?: unknown; error?: { message: string; code: string | null } };

    beforeAll(async () => {
        const build = await rolldown({
            input: 'entry',
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            platform: 'neutral',
            external: ['cloudflare:workers', 'node:async_hooks'],
            // As an application resolves the package; here, its own source.
            resolve: { conditionNames: ['workerd', 'worker', 'browser', 'import', 'module', 'default'], mainFields: ['module', 'main'], alias: { '@cossackframework/cms': fileURLToPath(new URL('../src/index.ts', import.meta.url)) } },
            plugins: [{
                name: 'entry',
                resolveId: (id: string) => id === 'entry' ? id : null,
                load: (id: string) => id === 'entry' ? `import * as plugin from ${JSON.stringify(`${FIXTURE}server.ts`)};
                    import manifest from ${JSON.stringify(`${FIXTURE}plugin.json`)};
                    import isolate from ${JSON.stringify(ISOLATE)};
                    export default isolate(plugin, manifest);` : null,
            }],
            logLevel: 'silent',
        });
        const { output } = await build.generate({ format: 'esm', codeSplitting: false });
        await build.close();
        mf = new Miniflare({ modules: true, script: LOADER(output[0].code), compatibilityDate: '2026-06-06', compatibilityFlags: ['nodejs_als'], workerLoaders: { LOADER: {} } });
        await mf.ready;
    }, 60_000);

    afterAll(async () => {
        await mf?.dispose();
    });

    it('runs a filter that reads settings through the bridge', async () => {
        expect(await run('main', { kind: 'filter', point: 'cms.resource.before-write', value: { title: 'ticket' }, input: { resource: 'desk/tickets' } })).toEqual({ value: { title: 'Hello ticket' } });
    });

    it('sends a Request out through the bridge and gets a Response back', async () => {
        expect(await run('two', { kind: 'command', name: 'ping', input: { n: 1 }, principal: { kind: 'user', id: 'u1', roles: [], permissions: [] } }))
            .toEqual({ value: { principal: 'user', status: 201, body: 'POST https://api.example.com/ping {"n":1}', site: 'two' } });
    });

    it('returns the bridge\'s refusal with its code', async () => {
        expect(await run('main', { kind: 'action', point: 'cms.resource.after-commit', payload: { id: 't1' } })).toEqual({ error: { message: 'Plugin desk has no grant for desk/tickets.', code: 'CMS_FORBIDDEN' } });
    });
});
