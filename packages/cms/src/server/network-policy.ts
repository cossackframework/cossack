/**
 * What a network decides for all its sites about plugins and themes, kept in the network
 * database's `cms_network` table. Every site's host reads it with its activation state; a
 * single-site install has no rows, and everything stays available.
 */
import type { RomeDB } from '@cossackframework/romedb';

/**
 * `network`: active on every site, with the grants a network admin approved; site admins
 * cannot turn it off. `available`: each site's admins choose. `hidden`: sites do not see it.
 */
export type NetworkPluginState = 'network' | 'available' | 'hidden';
export type NetworkThemeState = 'available' | 'hidden';

export interface NetworkPolicy {
    /** Plugins that are not `available`. A network-active plugin carries its approved grants. */
    readonly plugins: ReadonlyMap<string, { readonly state: 'network'; readonly grants: readonly string[] } | { readonly state: 'hidden' }>;
    readonly hiddenThemes: ReadonlySet<string>;
}

export const OPEN_POLICY: NetworkPolicy = Object.freeze({ plugins: new Map(), hiddenThemes: new Set<string>() });

/** `cms_network` keys. */
export const POLICY_KEYS = { plugins: 'plugins', themes: 'themes' } as const;

/** Stored shapes: `{ [plugin]: { state, grants? } }` and `{ [theme]: 'hidden' }`. */
export type StoredPluginStates = Record<string, { state: 'network'; grants: string[] } | { state: 'hidden' }>;
export type StoredThemeStates = Record<string, 'hidden'>;

/** The network's policy; open before setup, when `cms_network` does not exist yet. */
export async function readPolicy(db: RomeDB): Promise<NetworkPolicy> {
    let rows: readonly (readonly unknown[])[];
    try {
        rows = (await db.read([{ rql: 'SELECT key, value FROM cms_network WHERE key IN ($plugins, $themes)', params: { $plugins: POLICY_KEYS.plugins, $themes: POLICY_KEYS.themes } }])).results[0]!.rows;
    } catch (error) {
        if (/cms_network|no such table|not found/i.test(String((error as Error).message))) return OPEN_POLICY;
        throw error;
    }
    const stored = new Map(rows.map(([key, value]) => [key as string, parse(value)]));
    const plugins = new Map<string, { state: 'network'; grants: readonly string[] } | { state: 'hidden' }>();
    for (const [name, entry] of Object.entries(stored.get(POLICY_KEYS.plugins) ?? {})) {
        const value = entry as { state?: unknown; grants?: unknown };
        if (value?.state === 'hidden') plugins.set(name, Object.freeze({ state: 'hidden' }));
        else if (value?.state === 'network') plugins.set(name, Object.freeze({ state: 'network', grants: Object.freeze(Array.isArray(value.grants) ? value.grants.filter((grant): grant is string => typeof grant === 'string') : []) }));
    }
    const hiddenThemes = new Set(Object.entries(stored.get(POLICY_KEYS.themes) ?? {}).filter(([, state]) => state === 'hidden').map(([name]) => name));
    return Object.freeze({ plugins, hiddenThemes });
}

/** A plugin's state under the policy. */
export function pluginState(policy: NetworkPolicy, name: string): NetworkPluginState {
    return policy.plugins.get(name)?.state ?? 'available';
}

function parse(value: unknown): Record<string, unknown> {
    try {
        const parsed = JSON.parse(String(value)) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
}
