import { CMS_VERSION, checkForUpdate, compareVersions, type UpdateAnswer, type UpdateCheck } from '@cossackframework/cms';
import type { CmsNetwork } from '@cossackframework/cms/server';

/**
 * The update notice and the Update button (specs/cms-updates.md). The check and the request are
 * the network's: one answer and one pending request for all its sites, kept in the network's state.
 */
const CHECK = 'updates.check';
const REQUEST = 'updates.request';
const DAY = 24 * 3600 * 1000;

export interface UpdateSettings { check: boolean; url: string; channel: string }

/** An update a person asked the project's pipeline for. */
export interface UpdateRequest {
    version: string;
    requestedAt: number;
    /** The user's ID. */
    requestedBy: string;
}

export interface UpdateHook { url: string; token: string }

/** The hook from the environment, never from the database: both values, or none. */
export function updateHook(env: { CMS_UPDATE_HOOK_URL?: string; CMS_UPDATE_HOOK_TOKEN?: string }): UpdateHook | null {
    const url = env.CMS_UPDATE_HOOK_URL?.trim(), token = env.CMS_UPDATE_HOOK_TOKEN?.trim();
    if (!url || !token) return null;
    try { return /^https?:$/.test(new URL(url).protocol) ? { url, token } : null; }
    catch { return null; }
}

/** The page where the hook's work shows, when the hook is GitHub's `repository_dispatch`. */
export function hookProgressUrl(hook: UpdateHook | null): string | null {
    const match = hook && /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/dispatches\/?$/.exec(hook.url);
    return match ? `https://github.com/${match[1]}/${match[2]}/actions` : null;
}

/** The last check, or null when none ran. A check for another version or channel no longer counts. */
export async function storedCheck(network: CmsNetwork, settings: UpdateSettings): Promise<UpdateCheck | null> {
    const stored = await network.state<UpdateCheck>(CHECK).catch(() => undefined);
    if (!stored || stored.installed !== CMS_VERSION || stored.channel !== settings.channel) return null;
    return stored;
}

/**
 * Ask the update server when the last check is a day old, and keep its answer. The scheduled
 * run calls this; a page never does, so no page waits for the update server.
 */
export async function refreshUpdateCheck(network: CmsNetwork, settings: UpdateSettings, options: { now?: number; force?: boolean; fetch?: typeof globalThis.fetch } = {}): Promise<UpdateCheck | null> {
    if (!settings.check) return null;
    const now = options.now ?? Date.now();
    const previous = await storedCheck(network, settings);
    if (previous && !options.force && now - previous.checkedAt < DAY) return previous;
    const check = await checkForUpdate({ installed: CMS_VERSION, url: settings.url, channel: settings.channel, now, previous, ...(options.fetch ? { fetch: options.fetch } : {}) });
    await network.setState(CHECK, check);
    return check;
}

/** The pending request, or null: it ends when the running version reaches it, or after a day. */
export async function pendingRequest(network: CmsNetwork, now = Date.now()): Promise<UpdateRequest | null> {
    const stored = await network.state<UpdateRequest | null>(REQUEST).catch(() => undefined);
    if (!stored || typeof stored.version !== 'string') return null;
    if ((compareVersions(CMS_VERSION, stored.version) ?? 0) >= 0 || now - stored.requestedAt > DAY) return null;
    return stored;
}

export async function clearRequest(network: CmsNetwork): Promise<void> {
    await network.setState(REQUEST, null);
}

/** What Tools → Updates shows. */
export interface UpdateStatus {
    installed: string;
    checking: boolean;
    checkedAt: number | null;
    available: UpdateAnswer | null;
    error: string;
    request: UpdateRequest | null;
    /** The project set a hook, so the page shows the button. */
    hook: boolean;
    progressUrl: string | null;
}

export async function updateStatus(network: CmsNetwork, settings: UpdateSettings, hook: UpdateHook | null, now = Date.now()): Promise<UpdateStatus> {
    const check = settings.check ? await storedCheck(network, settings) : null;
    return {
        installed: CMS_VERSION, checking: settings.check, checkedAt: check?.checkedAt ?? null, available: check?.available ?? null, error: check?.error ?? '',
        request: await pendingRequest(network, now), hook: hook !== null, progressUrl: hookProgressUrl(hook),
    };
}

/**
 * Ask the project's pipeline to update the site. The version is the one the stored check
 * names: the caller cannot name another. The body is GitHub's `repository_dispatch` shape, which
 * any other pipeline can accept too.
 */
export async function requestUpdate(network: CmsNetwork, settings: UpdateSettings, hook: UpdateHook | null, by: string, options: { now?: number; fetch?: typeof globalThis.fetch } = {}): Promise<UpdateRequest> {
    if (!hook) throw new Error('No update hook is set: add CMS_UPDATE_HOOK_URL and CMS_UPDATE_HOOK_TOKEN to the environment.');
    const now = options.now ?? Date.now();
    const available = (await storedCheck(network, settings))?.available;
    if (!available) throw new Error('No newer version is known. The site checks once a day.');
    if (available.minimumFrom && (compareVersions(CMS_VERSION, available.minimumFrom) ?? 0) < 0) throw new Error(`Version ${available.latest} needs ${available.minimumFrom} first: update in two steps, with cossack upgrade --tag ${available.minimumFrom}.`);
    if (await pendingRequest(network, now)) throw new Error('An update is already requested.');
    const response = await (options.fetch ?? globalThis.fetch)(hook.url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${hook.token}`, 'content-type': 'application/json', accept: 'application/vnd.github+json, application/json', 'user-agent': 'cossack-cms' },
        body: JSON.stringify({ event_type: 'cossack-update', client_payload: { version: available.latest } }),
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new Error(`The update hook answered ${response.status}. Check CMS_UPDATE_HOOK_URL and the token's access.`);
    const request: UpdateRequest = { version: available.latest, requestedAt: now, requestedBy: by };
    await network.setState(REQUEST, request);
    return request;
}

/** Whether a newer version is known, for the dashboard menu; read at most once a minute per process. */
let known: { at: number; value: boolean } | undefined;
export async function updateAvailable(network: CmsNetwork, settings: UpdateSettings, now = Date.now()): Promise<boolean> {
    if (!settings.check) return false;
    if (known && now - known.at < 60_000) return known.value;
    const value = Boolean((await storedCheck(network, settings))?.available);
    known = { at: now, value };
    return value;
}
