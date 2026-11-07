import { describe, expect, it } from 'vitest';
import { CACHE_HOLDS, cacheControl, cacheHoldSeconds, cachePurge, cacheTagHeader, cacheTags, EXTENSION_POINTS, type CachePurgeEvent } from '../src/index';
import { cloudflarePurger, PurgeError, zoneCandidates, type PurgeContext } from '../src/server/index';

describe('cache headers', () => {
    it('holds pages five minutes by default, a day once a purger is configured, and as chosen otherwise', () => {
        expect(CACHE_HOLDS).toEqual(['auto', 'none', 'minute', 'hour', 'day', 'week']);
        expect(cacheHoldSeconds('auto')).toBe(300);
        expect(cacheHoldSeconds('auto', { purging: true })).toBe(86_400);
        expect(cacheHoldSeconds('none', { purging: true })).toBe(0);
        expect(cacheHoldSeconds('week')).toBe(604_800);
    });

    it('writes Cache-Control with max-age=0, the hold as s-maxage and a minute of stale-while-revalidate', () => {
        expect(cacheControl('auto')).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=60');
        expect(cacheControl('auto', { purging: true })).toBe('public, max-age=0, s-maxage=86400, stale-while-revalidate=60');
        expect(cacheControl('day', { max: 60 })).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=60');
        expect(cacheControl('minute')).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=60');
        expect(cacheControl('none')).toBe('private, no-store');
        expect(cacheControl('hour', { max: 0 })).toBe('private, no-store');
    });

    it('names tags without spaces or commas and joins them for the header', () => {
        expect(cacheTags.site('main')).toBe('cms:main');
        expect(cacheTags.collection('site_2', 'posts')).toBe('cms:site_2:c:posts');
        expect(cacheTags.entry('main', 'posts', 'a b,c')).toBe('cms:main:e:posts:a-b-c');
        expect(cacheTags.term('main', 'categories', 'news')).toBe('cms:main:t:categories:news');
        expect(cacheTagHeader(['cms:main', 'cms:main:c:posts', 'cms:main'])).toBe('cms:main,cms:main:c:posts');
        expect(EXTENSION_POINTS).toContain(cachePurge);
    });
});

describe('the Cloudflare purger', () => {
    const event = (tags: string[], urls: string[] = []): CachePurgeEvent => ({ eventId: 'e1', topic: 'cache.purge', at: 1, site: 'main', reason: 'test', tags, urls });
    const context = (): PurgeContext & { stored: Map<string, unknown> } => {
        const stored = new Map<string, unknown>();
        return { stored, signal: new AbortController().signal, cache: { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value); } } as unknown as PurgeContext['cache'] };
    };
    const recorder = (answer: (url: string, body: unknown) => Response) => {
        const calls: { url: string; method: string; body: unknown; authorization: string | null }[] = [];
        const fetch: typeof globalThis.fetch = async (input, init) => {
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ url: String(input), method: init?.method ?? 'GET', body, authorization: new Headers(init?.headers).get('authorization') });
            return answer(String(input), body);
        };
        return { calls, fetch };
    };

    it('lists the zones a host may belong to, down to its registrable parent', () => {
        expect(zoneCandidates('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com']);
        expect(zoneCandidates('Example.com:3000')).toEqual(['example.com']);
        expect(zoneCandidates('localhost')).toEqual([]);
        expect(zoneCandidates('blog.localhost')).toEqual([]);
        expect(zoneCandidates('127.0.0.1')).toEqual([]);
    });

    it('finds the zone by the host and its parents, remembers it, and purges thirty tags or URLs a request', async () => {
        const { calls, fetch } = recorder(url => url.includes('name=blog.example.com') ? Response.json({ success: true, result: [] }) : Response.json({ success: true, result: [{ id: 'zone-1' }] }));
        const purger = cloudflarePurger({ token: 'secret', hosts: () => ['blog.example.com'], fetch, api: 'https://api.test/client/v4/' });
        const ctx = context();
        const tags = Array.from({ length: 31 }, (_, index) => `cms:main:e:posts:${index}`);
        await purger.purge(event(tags, ['https://blog.example.com/posts/a']), ctx);
        expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
            'GET https://api.test/client/v4/zones?name=blog.example.com&per_page=1',
            'GET https://api.test/client/v4/zones?name=example.com&per_page=1',
            'POST https://api.test/client/v4/zones/zone-1/purge_cache',
            'POST https://api.test/client/v4/zones/zone-1/purge_cache',
            'POST https://api.test/client/v4/zones/zone-1/purge_cache',
        ]);
        expect(calls[0]!.authorization).toBe('Bearer secret');
        expect((calls[2]!.body as { tags: string[] }).tags).toHaveLength(30);
        expect(calls[3]!.body).toEqual({ tags: ['cms:main:e:posts:30'] });
        expect(calls[4]!.body).toEqual({ files: ['https://blog.example.com/posts/a'] });
        expect(ctx.stored.get('cloudflare.zone:blog.example.com')).toBe('zone-1');
        calls.length = 0;
        await purger.purge(event(['cms:main']), ctx);
        expect(calls.map(call => call.url)).toEqual(['https://api.test/client/v4/zones/zone-1/purge_cache']);
    });

    it('takes a zone ID without a lookup, retries a 429 or a 5xx, and records a refusal or a missing zone without retrying', async () => {
        let status = 429;
        const { calls, fetch } = recorder(() => Response.json({ success: false, errors: [{ message: 'Invalid access token' }] }, { status }));
        const purger = cloudflarePurger({ token: 'bad', zoneId: 'zone-9', hosts: () => ['example.com'], fetch });
        await expect(purger.purge(event(['cms:main']), context())).rejects.toMatchObject({ retry: true, status: 429 });
        status = 503;
        await expect(purger.purge(event(['cms:main']), context())).rejects.toMatchObject({ retry: true, status: 503 });
        status = 403;
        const refused = await purger.purge(event(['cms:main']), context()).catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(PurgeError);
        expect(refused).toMatchObject({ retry: false, status: 403, message: 'Cloudflare refused the request (403): Invalid access token' });
        expect(calls.every(call => call.url.startsWith('https://api.cloudflare.com/client/v4/zones/zone-9/purge_cache'))).toBe(true);

        const missing = cloudflarePurger({ token: 'ok', hosts: () => ['nowhere.example'], fetch: async () => Response.json({ success: true, result: [] }) });
        const ctx = context();
        await expect(missing.purge(event(['cms:main']), ctx)).rejects.toMatchObject({ retry: false, message: 'No Cloudflare zone of this token serves nowhere.example.' });
        expect(ctx.stored.get('cloudflare.zone:nowhere.example')).toBe('');
        const down = cloudflarePurger({ token: 'ok', zoneId: 'z', hosts: () => [], fetch: async () => { throw new TypeError('fetch failed'); } });
        await expect(down.purge(event(['cms:main']), context())).rejects.toMatchObject({ retry: true, message: 'Cloudflare could not be reached: fetch failed' });
    });
});
