import { describe, expect, it } from 'vitest';
import { manifestProblems, ISOLATE_PROTOCOL, type CmsPluginManifest, type IsolateCall } from '../src/index';
import { inFlightLimiter, ISOLATE_LIMITS, serveIsolatedCall, systemPrincipal, workerLoaderRunner, type PluginContext, type WorkerCodeLike } from '../src/server/index';

const call: IsolateCall = { protocol: ISOLATE_PROTOCOL, site: 'main', deadline: Date.now() + 1_000, resources: [], points: [], payments: null, run: { kind: 'action', point: 'cms.resource.after-commit', payload: {} } };
const plugin = { name: 'desk', version: '1.2.0', code: 'export default class {}', hash: 'a'.repeat(64) };
const props = { site: 'main', plugin: 'desk', deadline: call.deadline, principals: [] };

describe('the in-flight limit', () => {
    it('runs at most four distinct plugins at once per request, and the same plugin freely', async () => {
        const limit = inFlightLimiter(4, () => undefined);
        const running = new Set<string>();
        let most = 0;
        const releases: (() => void)[] = [];
        const started = (name: string) => limit(name, () => new Promise<void>(resolve => {
            running.add(name);
            most = Math.max(most, running.size);
            releases.push(() => { running.delete(name); resolve(); });
        }));
        const all = ['a', 'b', 'c', 'd', 'e', 'a'].map(started);
        await new Promise(resolve => setTimeout(resolve, 5));
        expect([...running].sort()).toEqual(['a', 'b', 'c', 'd']);
        // One of a's two calls ending leaves a in flight; b ending lets e in.
        releases.splice(0, 1)[0]!();
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(running.has('e')).toBe(false);
        releases.splice(0, 1)[0]!();
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(running.has('e')).toBe(true);
        while (releases.length) { releases.shift()!(); await new Promise(resolve => setTimeout(resolve, 1)); }
        await Promise.all(all);
        expect(most).toBe(4);
    });

    it('keeps requests apart', async () => {
        const requests = [{}, {}];
        let current = requests[0]!;
        const limit = inFlightLimiter(1, () => current);
        let release!: () => void;
        const first = limit('a', () => new Promise<void>(resolve => { release = resolve; }));
        current = requests[1]!;
        // Another request is not held up by the first one's plugin.
        await expect(limit('b', async () => 'ran')).resolves.toBe('ran');
        release();
        await first;
    });
});

describe('the Worker Loader runner', () => {
    function fakeLoader() {
        const loads: { id: string; code: WorkerCodeLike }[] = [];
        const entrypoints: unknown[] = [];
        const loader = {
            get(id: string, load: () => Promise<WorkerCodeLike>) {
                return {
                    getEntrypoint(_name?: string, options?: unknown) {
                        entrypoints.push(options);
                        return { run: async (given: IsolateCall, bridge: unknown) => { loads.push({ id, code: await load() }); return { given: given.site, bridge }; } };
                    },
                };
            },
        };
        return { loader, loads, entrypoints };
    }

    it('loads one Worker per plugin version, with no bindings and no network, and passes the bridge', async () => {
        const { loader, loads, entrypoints } = fakeLoader();
        const bridges: unknown[] = [];
        const runner = workerLoaderRunner({ loader, exports: () => ({ PluginBridge: options => { bridges.push(options.props); return 'bridge-stub'; }, PluginTail: options => `tail:${options.props.plugin}` }) });
        expect(await runner.run(plugin, call, props, 'hook')).toEqual({ given: 'main', bridge: 'bridge-stub' });
        await runner.run(plugin, call, props, 'work');
        expect(loads[0]!.id).toBe(`desk@1.2.0:${'a'.repeat(16)}`);
        expect(loads[0]!.code).toEqual({ compatibilityDate: '2026-06-06', compatibilityFlags: ['nodejs_als'], mainModule: 'plugin.js', modules: { 'plugin.js': plugin.code }, env: {}, globalOutbound: null, tails: ['tail:desk'] });
        expect(entrypoints).toEqual([{ limits: ISOLATE_LIMITS.hook }, { limits: ISOLATE_LIMITS.work }]);
        expect(bridges).toEqual([props, props]);
    });

    it('refuses to run without the application\'s PluginBridge', () => {
        const runner = workerLoaderRunner({ loader: fakeLoader().loader, exports: () => ({}) });
        expect(() => runner.run(plugin, call, props, 'hook')).toThrow('does not export PluginBridge');
    });
});

describe('the bridge', () => {
    const user = { kind: 'user', id: 'u1', roles: ['editor'], permissions: [] } as const;
    function context() {
        const seen: unknown[] = [];
        const repository = new Proxy({}, { get: (_target, method) => (...args: unknown[]) => { seen.push([method, ...args]); return 'ok'; } });
        const value = {
            name: 'desk',
            cms: { resource: (id: string) => { seen.push(['resource', id]); return repository; } },
            settings: { get: (field: string) => `setting:${field}`, all: () => ({}) },
            fetch: (request: Request) => `fetched:${request.url}`,
            cache: { get: (key: string) => `cache:${key}` },
            hooks: { point: (name: string, kind: string) => ({ name, kind }), doAction: (point: unknown, payload: unknown) => ['doAction', point, payload], applyFilters: (point: unknown, value: unknown, input: unknown) => ['applyFilters', point, value, input] },
        } as unknown as PluginContext;
        return { value, seen };
    }

    it('serves the members isolated plugins have from the plugin\'s context', async () => {
        const { value } = context();
        expect(await serveIsolatedCall(value, 'settings.get', ['greeting'], [])).toBe('setting:greeting');
        expect(await serveIsolatedCall(value, 'cache.get', ['k'], [])).toBe('cache:k');
        expect(await serveIsolatedCall(value, 'fetch', [new Request('https://api.example.com/')], [])).toBe('fetched:https://api.example.com/');
        expect(await serveIsolatedCall(value, 'hooks.doAction', ['desk.closed', { id: 1 }], [])).toEqual(['doAction', { name: 'desk.closed', kind: 'action' }, { id: 1 }]);
        await expect(serveIsolatedCall(value, 'unrestricted', [], [])).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(serveIsolatedCall(value, 'resource.purge', ['desk/tickets', {}], [])).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(serveIsolatedCall(value, 'fetch', ['https://api.example.com/'], [])).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('lets repository calls act only as a principal the call carried, or as the plugin', async () => {
        const { value, seen } = context();
        await serveIsolatedCall(value, 'resource.get', ['desk/tickets', 't1', { principal: systemPrincipal('plugin:desk') }], []);
        // Copied across the boundary, with keys in another order: still the same principal.
        await serveIsolatedCall(value, 'resource.list', ['desk/tickets', {}, { principal: { permissions: [], roles: ['editor'], id: 'u1', kind: 'user' } }], [user]);
        expect(seen).toEqual([['resource', 'desk/tickets'], ['get', 't1', { principal: systemPrincipal('plugin:desk') }], ['resource', 'desk/tickets'], ['list', {}, { principal: { permissions: [], roles: ['editor'], id: 'u1', kind: 'user' } }]]);
        for (const forged of [{ ...user, roles: ['administrator'] }, systemPrincipal('plugin:other'), systemPrincipal('outbox'), undefined]) {
            await expect(serveIsolatedCall(value, 'resource.get', ['desk/tickets', 't1', { principal: forged }], [user])).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        }
        await expect(serveIsolatedCall(value, 'resource.get', ['desk/tickets', 't1'], [user])).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
    });
});

describe('manifest fields for isolation', () => {
    const base = { schemaVersion: 1, name: 'desk', version: '1.0.0' } as CmsPluginManifest;
    it('takes a whole-number hook priority and only false for isolation', () => {
        expect(manifestProblems({ ...base, hooks: [{ point: 'cms.resource.after-commit', version: 1, priority: 5 }], isolation: false })).toEqual([]);
        expect(manifestProblems({ ...base, hooks: [{ point: 'cms.resource.after-commit', version: 1, priority: 1.5 }] })).toEqual(['hooks: cms.resource.after-commit priority must be a whole number from -1000 to 1000.']);
        expect(manifestProblems({ ...base, isolation: true } as never)).toEqual(['isolation can only be false, which keeps the plugin in the application.']);
    });
});
