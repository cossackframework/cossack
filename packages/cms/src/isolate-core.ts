/**
 * The plugin side of an isolated plugin, without platform imports so Node can test it:
 * `isolate.ts` wraps it in a `WorkerEntrypoint` with `AsyncLocalStorage`.
 *
 * `register()` runs once per site in each isolate, under that site's call, and gets a context
 * shaped like the one plugins get in the application. Its members forward to the bridge of
 * the call in progress, so a handler that captured `context` at registration reaches the host
 * of whichever call runs it.
 */
import { createHookRegistry, HookError, type ExtensionPoint, type HookRegistry } from '@cossackframework/core/hooks';
import type { CmsPluginManifest } from './manifest';
import { mediaUrl } from './media';
import type { Principal } from './permissions';
import { ISOLATE_PROTOCOL, type IsolateBridge, type IsolateCall, type IsolateMember, type IsolatePoint } from './isolation';
import type { CommandHandler, PluginContext } from './server/host';
import type { PluginJobHandler } from './server/capabilities';

/** The call in progress; `AsyncLocalStorage` in the isolate. */
export interface CallScope<T> {
    run<R>(store: T, fn: () => R): R;
    getStore(): T | undefined;
}

export interface CurrentCall {
    readonly bridge: IsolateBridge;
    readonly call: IsolateCall;
}

interface SiteRegistrations {
    readonly hooks: HookRegistry;
    readonly points: ReadonlyMap<string, ExtensionPoint>;
    readonly commands: ReadonlyMap<string, CommandHandler>;
    readonly jobs: ReadonlyMap<string, PluginJobHandler>;
}

export interface IsolateRuntime {
    run(call: IsolateCall, bridge: IsolateBridge): Promise<unknown>;
}

/** As the host's `JOB_NAME`. */
const JOB_NAME = /^[a-z][a-z0-9-]{0,40}$/;

/** An error that keeps its code across the boundary, like the host's `CmsError`. */
function failure(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}

export function createIsolateRuntime(plugin: Readonly<Record<string, unknown>>, manifest: CmsPluginManifest, scope: CallScope<CurrentCall>): IsolateRuntime {
    const name = manifest.name;
    const sites = new Map<string, Promise<SiteRegistrations>>();
    const declared = new Set((manifest.hooks ?? []).map(hook => hook.point));
    const provided = new Set((manifest.provides ?? []).map(point => point.point));
    const declaredCommands = new Set((manifest.commands ?? []).map(command => command.name));

    const current = (): CurrentCall => {
        const store = scope.getStore();
        if (!store) throw new Error(`Plugin ${name} used its context outside a call from the host.`);
        return store;
    };
    const forward = (member: IsolateMember, ...args: unknown[]): Promise<unknown> => current().bridge.call(member, args);

    async function registerFor(call: IsolateCall): Promise<SiteRegistrations> {
        const hooks = createHookRegistry();
        const points = new Map<string, ExtensionPoint>(call.points.map((point: IsolatePoint) => [point.name, Object.freeze({ ...point })]));
        const commands = new Map<string, CommandHandler>();
        const jobs = new Map<string, PluginJobHandler>();
        const checkHook = (point: ExtensionPoint) => {
            if (!declared.has(point.name)) throw new Error(`Plugin ${name} registers ${point.name}, which its manifest does not declare in hooks.`);
            const known = points.get(point.name);
            if (known && (known.kind !== point.kind || known.version !== point.version)) throw new Error(`Plugin ${name} registers ${point.name} as a version ${point.version} ${point.kind}; the host has a version ${known.version} ${known.kind}.`);
        };
        const checkProvided = (point: ExtensionPoint) => {
            if (!provided.has(point.name)) throw new Error(`Plugin ${name} invokes ${point.name}, which its manifest does not declare in provides.`);
        };
        // Signals cannot cross; the host keeps its own deadline.
        const withoutSignal = (options: unknown) => {
            if (!options || typeof options !== 'object') return options;
            const { signal: _signal, ...rest } = options as { signal?: unknown };
            return rest;
        };
        const resource = (id: string) => {
            const at = (method: string, ...args: unknown[]) => forward(`resource.${method}` as IsolateMember, id, ...args.map(withoutSignal));
            return {
                get: (key: unknown, context: unknown) => at('get', key, context),
                list: (options: unknown, context: unknown) => at('list', options, context),
                search: (query: unknown, options: unknown, context: unknown) => at('search', query, options, context),
                create: (input: unknown, context: unknown) => at('create', input, context),
                update: (key: unknown, patch: unknown, context: unknown) => at('update', key, patch, context),
                delete: (key: unknown, context: unknown) => at('delete', key, context),
            };
        };
        const context = {
            name,
            version: manifest.version,
            resources: call.resources,
            hooks: {
                addAction: (point: ExtensionPoint, handler: (payload: unknown, context: unknown) => unknown, options: { priority?: number } = {}) => {
                    checkHook(point);
                    hooks.addAction(point as never, handler as never, { ...options, plugin: name });
                },
                addFilter: (point: ExtensionPoint, handler: (value: unknown, context: unknown) => unknown, options: { priority?: number } = {}) => {
                    checkHook(point);
                    hooks.addFilter(point as never, handler as never, { ...options, plugin: name });
                },
                point: (pointName: string, kind: 'action' | 'filter') => {
                    const known = points.get(pointName);
                    if (!known) throw new Error(`Plugin ${name} asks for ${pointName}, which its manifest does not declare in hooks or provides.`);
                    if (known.kind !== kind) throw new Error(`${pointName} is ${known.kind === 'action' ? 'an action' : 'a filter'}, not ${kind === 'action' ? 'an action' : 'a filter'}.`);
                    return known;
                },
                doAction: (point: ExtensionPoint, payload: unknown, options?: unknown) => { checkProvided(point); return forward('hooks.doAction', point.name, payload, withoutSignal(options)); },
                applyFilters: (point: ExtensionPoint, value: unknown, input: unknown, options?: unknown) => { checkProvided(point); return forward('hooks.applyFilters', point.name, value, input, withoutSignal(options)); },
            },
            commands: {
                add: (command: string, handler: CommandHandler) => {
                    if (!declaredCommands.has(command)) throw new Error(`Plugin ${name} adds command ${command}, which its manifest does not declare.`);
                    commands.set(command, handler);
                },
            },
            cms: { resource },
            settings: {
                get: (field: string) => forward('settings.get', field),
                all: () => forward('settings.all'),
            },
            fetch: (input: RequestInfo | URL, init?: RequestInit) => forward('fetch', new Request(input, init)),
            files: {
                upload: (file: unknown) => forward('files.upload', file),
                get: (id: string) => forward('files.get', id),
                list: (options?: unknown) => forward('files.list', options),
                open: (id: string) => forward('files.open', id),
                update: (id: string, patch: unknown) => forward('files.update', id, patch),
                delete: (id: string) => forward('files.delete', id),
                url: (file: { readonly id: string; readonly name: string }) => mediaUrl(file),
            },
            mail: { send: (message: unknown) => forward('mail.send', message) },
            jobs: {
                handle: (jobName: string, handler: PluginJobHandler) => {
                    if (typeof jobName !== 'string' || !JOB_NAME.test(jobName)) throw new Error(`Plugin ${name} names job ${String(jobName)}; job names are lowercase letters, digits and hyphens.`);
                    if (typeof handler !== 'function') throw new Error(`Plugin ${name} handles job ${jobName} without a function.`);
                    if (jobs.has(jobName)) throw new Error(`Plugin ${name} handles job ${jobName} twice.`);
                    jobs.set(jobName, handler);
                },
                enqueue: async (jobName: string, payload?: unknown, options?: unknown) => {
                    if (typeof jobName !== 'string' || !jobs.has(jobName)) throw failure('CMS_NOT_FOUND', `Plugin ${name} has no handler for job ${String(jobName)}.`);
                    return forward('jobs.enqueue', jobName, payload ?? null, options ?? {});
                },
            },
            users: {
                get: (id: string) => forward('users.get', id),
                findByEmail: (email: string) => forward('users.findByEmail', email),
                list: (options?: unknown) => forward('users.list', options),
                create: (input: unknown) => forward('users.create', input),
                setMeta: (id: string, value: unknown) => forward('users.setMeta', id, value),
            },
            cache: {
                get: (key: string) => forward('cache.get', key),
                set: (key: string, value: unknown, ttlMs?: number) => forward('cache.set', key, value, ttlMs),
                delete: (key: string) => forward('cache.delete', key),
                // The compute function stays here: only the value crosses.
                remember: async (key: string, ttlMs: number, compute: () => Promise<unknown>) => {
                    const cached = await forward('cache.get', key);
                    if (cached !== undefined) return cached;
                    const value = await compute();
                    await forward('cache.set', key, value, ttlMs);
                    return value;
                },
            },
            secrets: { get: (secret: string) => forward('secrets.get', secret) },
            ai: { complete: (request: unknown) => forward('ai.complete', request) },
            payments: {
                checkout: (input: unknown) => forward('payments.checkout', input),
                get provider() { return current().call.payments; },
            },
            unrestricted: async () => { throw failure('CMS_FORBIDDEN', `Plugin ${name} runs isolated, where unrestricted access does not exist.`); },
        };
        const register = plugin.register;
        if (typeof register === 'function') await (register as (context: PluginContext) => unknown)(context as unknown as PluginContext);
        hooks.freeze();
        return { hooks, points, commands, jobs };
    }

    function registrations(call: IsolateCall): Promise<SiteRegistrations> {
        let pending = sites.get(call.site);
        if (!pending) {
            pending = registerFor(call);
            sites.set(call.site, pending);
            // A failed registration is tried again on the next call.
            pending.catch(() => { if (sites.get(call.site) === pending) sites.delete(call.site); });
        }
        return pending;
    }

    /** The handler's own error, so its code reaches the host; timeouts and cancellations stay hook errors. */
    const cause = (error: unknown): unknown => error instanceof HookError && error.code === 'COSSACK_HOOK_FAILED' && error.cause !== undefined ? error.cause : error;

    const withDeadline = async <T>(deadline: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(failure('COSSACK_HOOK_TIMEOUT', `Plugin ${name} did not finish before its deadline.`)), Math.max(0, deadline - Date.now()));
        try { return await run(controller.signal); } finally { clearTimeout(timer); }
    };

    return {
        run(call, bridge) {
            if (call?.protocol !== ISOLATE_PROTOCOL) return Promise.reject(new Error(`Plugin ${name} was built for isolate protocol ${ISOLATE_PROTOCOL}, and the host called it with ${String(call?.protocol)}. Rebuild the application.`));
            return scope.run({ bridge, call }, async () => {
                const site = await registrations(call);
                const run = call.run;
                const timeoutMs = Math.max(1, call.deadline - Date.now());
                switch (run.kind) {
                    case 'action': {
                        const point = site.points.get(run.point);
                        if (!point || point.kind !== 'action') throw new Error(`Plugin ${name} was asked to run ${run.point}, which it does not handle as an action.`);
                        const report = await site.hooks.doAction(point as never, run.payload, { timeoutMs });
                        const failed = report.outcomes.find(outcome => outcome.status !== 'ok');
                        if (failed) throw cause(failed.error);
                        return null;
                    }
                    case 'filter': {
                        const point = site.points.get(run.point);
                        if (!point || point.kind !== 'filter') throw new Error(`Plugin ${name} was asked to run ${run.point}, which it does not handle as a filter.`);
                        const applyFilters = site.hooks.applyFilters.bind(site.hooks) as (point: ExtensionPoint, value: unknown, input: unknown, options: { timeoutMs: number }) => Promise<unknown>;
                        try { return await applyFilters(point, run.value, run.input, { timeoutMs }); }
                        catch (error) { throw cause(error); }
                    }
                    case 'command': {
                        const handler = site.commands.get(run.name);
                        if (!handler) throw failure('CMS_NOT_FOUND', `Plugin ${name} has no handler for command ${run.name}.`);
                        return withDeadline(call.deadline, signal => Promise.resolve(handler(run.input, { principal: run.principal, signal })));
                    }
                    case 'job': {
                        const handler = site.jobs.get(run.name);
                        if (!handler) throw failure('CMS_NOT_FOUND', `Plugin ${name} has no handler for job ${run.name}.`);
                        await withDeadline(call.deadline, signal => Promise.resolve(handler(run.payload, { principal: run.principal as Principal, scheduledAt: run.scheduledAt, signal })));
                        return null;
                    }
                }
            });
        },
    };
}
