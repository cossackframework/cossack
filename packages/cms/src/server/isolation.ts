/**
 * The host's side of isolated plugins (specs/cms-plugin-isolation.md): the runner that calls
 * a plugin's Worker, and what the bridge serves back. Platform-free: the Cloudflare pieces
 * that import `cloudflare:workers` are in `../cloudflare.ts`.
 */
import { getRequestContext } from '@cossackframework/core';
import { CmsError } from '../errors';
import { ISOLATE_MEMBERS, type IsolateCall, type IsolateEntrypoint } from '../isolation';
import { systemPrincipal, type Principal } from '../permissions';
import type { PluginContext } from './host';

/** An isolated plugin's bundle, from the registry. */
export interface IsolatedPluginCode {
    readonly name: string;
    readonly version: string;
    readonly code: string;
    readonly hash: string;
}

/** What only the host knows about a call; the bridge reads it from its props. */
export interface BridgeProps {
    readonly site: string;
    readonly plugin: string;
    /** Unix milliseconds after which the bridge refuses the call. */
    readonly deadline: number;
    /** The principals the host passed with the call: the only ones the plugin may act as, besides its own. */
    readonly principals: readonly Principal[];
}

/** Hooks are short; commands, jobs and schedules do work. */
export type IsolatedWork = 'hook' | 'work';

export interface PluginRunner {
    run(plugin: IsolatedPluginCode, call: IsolateCall, props: BridgeProps, work: IsolatedWork): Promise<unknown>;
}

export interface IsolateLimits {
    readonly cpuMs: number;
    readonly subRequests: number;
}

/** First guesses, to check on Cloudflare: Miniflare enforces neither. */
export const ISOLATE_LIMITS: Readonly<Record<IsolatedWork, IsolateLimits>> = Object.freeze({
    hook: Object.freeze({ cpuMs: 50, subRequests: 50 }),
    work: Object.freeze({ cpuMs: 1_000, subRequests: 1_000 }),
});

/** Distinct Dynamic Workers a Worker request may have in flight. */
export const ISOLATES_IN_FLIGHT = 4;

/** The compatibility date isolated plugins run with; generated applications use the same. */
export const ISOLATE_COMPATIBILITY_DATE = '2026-06-06';

/** The Worker Loader binding (`env.LOADER`), as far as the runner uses it. */
export interface WorkerLoaderLike {
    get(id: string, load: () => Promise<WorkerCodeLike>): { getEntrypoint(name?: string, options?: { limits?: IsolateLimits }): unknown };
}

export interface WorkerCodeLike {
    readonly compatibilityDate: string;
    readonly compatibilityFlags?: readonly string[];
    readonly mainModule: string;
    readonly modules: Readonly<Record<string, string>>;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly globalOutbound?: unknown;
    readonly tails?: readonly unknown[];
}

/** The application's loopback exports (`ctx.exports`): its `PluginBridge`, and `PluginTail` for logs. */
export interface LoopbackExports {
    readonly PluginBridge?: (options: { props: BridgeProps }) => unknown;
    readonly PluginTail?: (options: { props: { plugin: string } }) => unknown;
}

const SHARED = {};

/** At most `limit` distinct plugins in flight per request; the rest wait their turn. */
export function inFlightLimiter(limit: number, request: () => object | undefined = () => getRequestContext()) {
    const requests = new WeakMap<object, { running: Map<string, number>; waiting: (() => void)[] }>();
    return async <T>(plugin: string, run: () => Promise<T>): Promise<T> => {
        const key = request() ?? SHARED;
        let state = requests.get(key);
        if (!state) { state = { running: new Map(), waiting: [] }; requests.set(key, state); }
        const entry = state;
        while (!entry.running.has(plugin) && entry.running.size >= limit) await new Promise<void>(resolve => entry.waiting.push(resolve));
        entry.running.set(plugin, (entry.running.get(plugin) ?? 0) + 1);
        try { return await run(); }
        finally {
            const count = (entry.running.get(plugin) ?? 1) - 1;
            if (count) entry.running.set(plugin, count);
            else { entry.running.delete(plugin); entry.waiting.splice(0).forEach(resolve => resolve()); }
        }
    };
}

/**
 * Runs isolated plugins in Dynamic Workers: one per plugin version, shared by every site,
 * with no bindings and no network, and the bridge passed with each call.
 */
export function workerLoaderRunner(options: {
    readonly loader: WorkerLoaderLike;
    readonly exports: () => LoopbackExports;
    readonly compatibilityDate?: string;
    readonly limits?: Partial<Record<IsolatedWork, IsolateLimits>>;
}): PluginRunner {
    const limit = inFlightLimiter(ISOLATES_IN_FLIGHT);
    const limits = { ...ISOLATE_LIMITS, ...options.limits };
    return {
        run(plugin, call, props, work) {
            const exports = options.exports();
            if (!exports.PluginBridge) throw new CmsError('CMS_UNAVAILABLE', 'The application does not export PluginBridge, which isolated plugins call the CMS through.');
            const tail = exports.PluginTail;
            const worker = options.loader.get(`${plugin.name}@${plugin.version}:${plugin.hash.slice(0, 16)}`, async () => ({
                compatibilityDate: options.compatibilityDate ?? ISOLATE_COMPATIBILITY_DATE,
                // AsyncLocalStorage keeps concurrent calls on their own bridges.
                compatibilityFlags: ['nodejs_als'],
                mainModule: 'plugin.js',
                modules: { 'plugin.js': plugin.code },
                env: {},
                globalOutbound: null,
                ...(tail ? { tails: [tail({ props: { plugin: plugin.name } })] } : {}),
            }));
            const entrypoint = worker.getEntrypoint(undefined, { limits: limits[work] }) as IsolateEntrypoint;
            const bridge = exports.PluginBridge({ props });
            return limit(plugin.name, () => entrypoint.run(call, bridge as never));
        },
    };
}

/** Principals compared by value: the host hands out plain objects, and they cross as copies. */
function samePrincipal(left: unknown, right: Principal): boolean {
    return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
    return JSON.stringify(value) ?? 'undefined';
}

const RESOURCE_METHODS = new Set(['get', 'list', 'count', 'search', 'create', 'update', 'delete']);

/**
 * Serve one bridge call from the plugin's context: the one the host builds for in-app plugins,
 * so every grant and limit check applies unchanged. Only `ISOLATE_MEMBERS` are served, and a
 * repository call must act as a principal the host gave the call, or as the plugin itself.
 */
export async function serveIsolatedCall(context: PluginContext, member: string, args: readonly unknown[], principals: readonly Principal[]): Promise<unknown> {
    const name = context.name;
    if (!(ISOLATE_MEMBERS as readonly string[]).includes(member)) throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} asked for ${member}, which isolated plugins cannot use.`);
    const [group, method] = member.split('.') as [string, string | undefined];
    const call = (target: object, key: string, values: readonly unknown[]) => (target as Record<string, (...values: unknown[]) => unknown>)[key]!(...values);
    switch (group) {
        case 'settings': return method === 'get' ? context.settings.get(String(args[0])) : context.settings.all();
        case 'resource': {
            const [id, ...rest] = args;
            if (!method || !RESOURCE_METHODS.has(method)) throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} asked for ${member}.`);
            const operation = rest.at(-1) as { principal?: unknown } | undefined;
            const own = systemPrincipal(`plugin:${name}`);
            if (!operation || typeof operation !== 'object' || !(samePrincipal(operation.principal, own) || principals.some(principal => samePrincipal(operation.principal, principal)))) {
                throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} must act as the principal its handler was given, or as plugin:${name}.`);
            }
            return call(context.cms.resource(String(id)), method, rest);
        }
        case 'fetch': {
            const request = args[0];
            if (!(request instanceof Request)) throw new CmsError('CMS_VALIDATION', `Plugin ${name} must fetch with a Request.`);
            return context.fetch(request);
        }
        case 'hooks': {
            const [point, ...rest] = args;
            if (method === 'doAction') return context.hooks.doAction(context.hooks.point(String(point), 'action'), rest[0], rest[1] as never);
            return context.hooks.applyFilters(context.hooks.point(String(point), 'filter'), rest[0], rest[1], rest[2] as never);
        }
        case 'files': case 'mail': case 'jobs': case 'users': case 'cache': case 'secrets': case 'ai': case 'payments':
            return call(context[group as 'files'], method!, args);
    }
    throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} asked for ${member}.`);
}
