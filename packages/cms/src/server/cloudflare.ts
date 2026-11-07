/**
 * The Cloudflare purger: purges the zone's cache by tag and by URL through the API. The token
 * needs Zone → Cache Purge, and Zone → Zone Read unless the zone ID is given: the zone is then
 * found by the site's host and its parent domains, and remembered for a day in the site's
 * cache. A 429 or 5xx retries through the outbox; another refusal is recorded and dropped.
 */
import { PurgeError, type CachePurger, type PurgeContext } from './purge';
import type { CachePurgeEvent } from '../hooks';

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
/** Tags or URLs one purge request takes. */
const PER_REQUEST = 30;
const ZONE_TTL = 24 * 60 * 60_000;
const MISSING_TTL = 10 * 60_000;

export interface CloudflarePurgerOptions {
    /** An API token with Zone → Cache Purge, and Zone → Zone Read when `zoneId` is not given. */
    readonly token: string;
    /** The zone to purge; without it the zone is looked up by host. */
    readonly zoneId?: string;
    /** The hosts the site answers at, for the zone lookup. */
    readonly hosts: () => readonly string[] | Promise<readonly string[]>;
    readonly fetch?: typeof globalThis.fetch;
    /** The API's base URL, for tests. */
    readonly api?: string;
}

/** The zones a host may belong to, from the host itself up to its registrable parent. */
export function zoneCandidates(host: string): string[] {
    const name = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    if (!name || name === 'localhost' || name.endsWith('.localhost') || /^[\d.]+$/.test(name) || name.includes(':')) return [];
    const labels = name.split('.');
    const candidates: string[] = [];
    for (let index = 0; index <= labels.length - 2; index++) candidates.push(labels.slice(index).join('.'));
    return candidates;
}

export function cloudflarePurger(options: CloudflarePurgerOptions): CachePurger {
    const api = (options.api ?? CLOUDFLARE_API).replace(/\/+$/, '');
    const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const headers = { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' };

    const call = async (method: string, path: string, body: unknown, signal: AbortSignal): Promise<{ result?: unknown; errors?: { message?: string }[] }> => {
        let response: Response;
        try {
            response = await send(`${api}${path}`, { method, headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        } catch (error) {
            throw new PurgeError(`Cloudflare could not be reached: ${(error as Error).message}`, { retry: true, cause: error });
        }
        const json = await response.json().catch(() => ({})) as { success?: boolean; result?: unknown; errors?: { message?: string }[] };
        if (response.status === 429 || response.status >= 500) throw new PurgeError(`Cloudflare answered ${response.status}.`, { retry: true, status: response.status });
        if (!response.ok || json.success === false) {
            const message = json.errors?.map(error => error.message).filter(Boolean).join(' ') ?? '';
            throw new PurgeError(`Cloudflare refused the request (${response.status})${message ? `: ${message}` : '.'}`, { retry: false, status: response.status });
        }
        return json;
    };

    /** The zone of a host, from the cache or the API; '' when no zone of the account serves it. */
    const zoneOf = async (host: string, context: PurgeContext): Promise<string> => {
        const key = `cloudflare.zone:${host.toLowerCase()}`;
        const known = await context.cache.get<string>(key);
        if (typeof known === 'string') return known;
        for (const candidate of zoneCandidates(host)) {
            const json = await call('GET', `/zones?name=${encodeURIComponent(candidate)}&per_page=1`, undefined, context.signal);
            const zone = Array.isArray(json.result) ? (json.result[0] as { id?: unknown } | undefined)?.id : undefined;
            if (typeof zone === 'string' && zone) {
                await context.cache.set(key, zone, ZONE_TTL);
                return zone;
            }
        }
        await context.cache.set(key, '', MISSING_TTL);
        return '';
    };

    return {
        name: 'cloudflare',
        async purge(event: CachePurgeEvent, context: PurgeContext): Promise<void> {
            let zones: string[];
            if (options.zoneId) zones = [options.zoneId];
            else {
                const hosts = [...new Set(await options.hosts())];
                zones = [...new Set((await Promise.all(hosts.map(host => zoneOf(host, context)))).filter(Boolean))];
                if (!zones.length) throw new PurgeError(`No Cloudflare zone of this token serves ${hosts.join(', ') || 'the site'}.`, { retry: false });
            }
            for (const zone of zones) {
                for (let index = 0; index < event.tags.length; index += PER_REQUEST) await call('POST', `/zones/${zone}/purge_cache`, { tags: event.tags.slice(index, index + PER_REQUEST) }, context.signal);
                for (let index = 0; index < event.urls.length; index += PER_REQUEST) await call('POST', `/zones/${zone}/purge_cache`, { files: event.urls.slice(index, index + PER_REQUEST) }, context.signal);
            }
        },
    };
}
