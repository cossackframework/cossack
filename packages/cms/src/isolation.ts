/**
 * What crosses between the host and an isolated plugin (specs/cms-plugin-isolation.md).
 *
 * The host calls the plugin's Worker with one `IsolateCall` and a bridge stub; the plugin
 * reaches the CMS only through `bridge.call(member, args)`, for the members below. Everything
 * else crosses as structured clones. Imports nothing, so both sides can use it.
 */
import type { Principal } from './permissions';

/** Raised when either side changes what a call means. */
export const ISOLATE_PROTOCOL = 1;

/** A point the plugin may handle, provide or ask for, as the host built it. */
export interface IsolatePoint {
    readonly name: string;
    readonly kind: 'action' | 'filter';
    readonly version: number;
    readonly timeoutMs: number;
}

export type IsolateRun =
    | { readonly kind: 'action'; readonly point: string; readonly payload: unknown }
    | { readonly kind: 'filter'; readonly point: string; readonly value: unknown; readonly input: unknown }
    | { readonly kind: 'command'; readonly name: string; readonly input: { readonly [name: string]: string | number | boolean }; readonly principal: Principal }
    | { readonly kind: 'job'; readonly name: string; readonly payload: unknown; readonly scheduledAt: number | null; readonly principal: Principal };

/** One call into a plugin's Worker. */
export interface IsolateCall {
    readonly protocol: typeof ISOLATE_PROTOCOL;
    /** The site the call is for: registrations are kept per site, since `register()` may read its settings. */
    readonly site: string;
    /** Unix milliseconds; handlers' signals abort then, and the bridge refuses calls after it. */
    readonly deadline: number;
    /** The plugin's resource IDs, as the host computed them. */
    readonly resources: readonly string[];
    /** Every point the manifest lists in `hooks` or `provides`. */
    readonly points: readonly IsolatePoint[];
    /** The application's payments provider, or null. */
    readonly payments: string | null;
    readonly run: IsolateRun;
}

/** The members an isolated plugin's context forwards to the host; the bridge serves exactly these. */
export const ISOLATE_MEMBERS = [
    'settings.get', 'settings.all',
    'resource.get', 'resource.list', 'resource.search', 'resource.create', 'resource.update', 'resource.delete',
    'fetch',
    'files.upload', 'files.get', 'files.list', 'files.open', 'files.update', 'files.delete',
    'mail.send',
    'jobs.enqueue',
    'users.get', 'users.findByEmail', 'users.list', 'users.create', 'users.setMeta',
    'cache.get', 'cache.set', 'cache.delete',
    'secrets.get',
    'ai.complete',
    'payments.checkout',
    'hooks.doAction', 'hooks.applyFilters',
] as const;

export type IsolateMember = typeof ISOLATE_MEMBERS[number];

/** The host's side of a call, as the plugin's Worker sees it: one method, an allow list behind it. */
export interface IsolateBridge {
    call(member: IsolateMember, args: readonly unknown[]): Promise<unknown>;
}

/** The plugin's Worker, as the host sees it. */
export interface IsolateEntrypoint {
    run(call: IsolateCall, bridge: IsolateBridge): Promise<unknown>;
}
