import { describe, expect, it } from 'vitest';
import { CMS_VERSION } from '@cossackframework/cms';
import type { CmsNetwork } from '@cossackframework/cms/server';
import { clearRequest, hookProgressUrl, pendingRequest, refreshUpdateCheck, requestUpdate, storedCheck, updateHook, updateStatus } from '../src/cms/updates';

const DAY = 24 * 3600 * 1000;
const settings = { check: true, url: 'https://updates.test/update', channel: 'latest' };
const hook = { url: 'https://api.github.com/repos/acme/site/dispatches', token: 'secret-token' };
/** A version the update server names as newer than the installed one. */
const NEWER = `${Number(CMS_VERSION.split('.')[0]) + 1}.0.0`;

/** The network's key and value state, in memory. */
function network() {
    const values = new Map<string, unknown>();
    return { values, network: { state: async (key: string) => values.get(key), setState: async (key: string, value: unknown) => { values.set(key, value); } } as unknown as CmsNetwork };
}

function server(body: unknown = { latest: NEWER, security: true, notes: 'https://cossack.dev/releases/next' }) {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { requests.push({ url: String(input), init }); return new Response(JSON.stringify(body), { status: 200 }); }) as typeof globalThis.fetch;
    return { requests, fetch };
}

describe('the update notice', () => {
    it('asks the update server once a day and keeps the answer', async () => {
        const { network: net } = network();
        const updates = server();
        const first = await refreshUpdateCheck(net, settings, { now: 1000, fetch: updates.fetch });
        expect(first?.available).toEqual({ latest: NEWER, security: true, notes: 'https://cossack.dev/releases/next' });
        expect(updates.requests.map(request => request.url)).toEqual([`https://updates.test/update?version=${CMS_VERSION}&channel=latest`]);
        // Within the day the stored answer is used.
        await refreshUpdateCheck(net, settings, { now: 1000 + DAY - 1, fetch: updates.fetch });
        expect(updates.requests).toHaveLength(1);
        await refreshUpdateCheck(net, settings, { now: 1000 + DAY, fetch: updates.fetch });
        expect(updates.requests).toHaveLength(2);
        expect((await storedCheck(net, settings))?.checkedAt).toBe(1000 + DAY);
        // Another channel is another question.
        expect(await storedCheck(net, { ...settings, channel: 'canary' })).toBeNull();
    });

    it('sends nothing when the project turned the check off', async () => {
        const { network: net, values } = network();
        const updates = server();
        expect(await refreshUpdateCheck(net, { ...settings, check: false }, { fetch: updates.fetch })).toBeNull();
        expect(updates.requests).toEqual([]);
        expect(values.size).toBe(0);
        expect(await updateStatus(net, { ...settings, check: false }, null)).toMatchObject({ installed: CMS_VERSION, checking: false, available: null, hook: false });
    });

    it('reads the hook from the environment: both values, or none', () => {
        expect(updateHook({ CMS_UPDATE_HOOK_URL: ` ${hook.url} `, CMS_UPDATE_HOOK_TOKEN: 'secret-token' })).toEqual(hook);
        expect(updateHook({ CMS_UPDATE_HOOK_URL: hook.url })).toBeNull();
        expect(updateHook({ CMS_UPDATE_HOOK_TOKEN: 'secret-token' })).toBeNull();
        expect(updateHook({ CMS_UPDATE_HOOK_URL: 'ftp://example.com/hook', CMS_UPDATE_HOOK_TOKEN: 'x' })).toBeNull();
        expect(hookProgressUrl(hook)).toBe('https://github.com/acme/site/actions');
        expect(hookProgressUrl({ url: 'https://ci.example.com/hooks/update', token: 'x' })).toBeNull();
    });

    it('asks the project\'s pipeline for the version the check named, once', async () => {
        const { network: net } = network();
        await refreshUpdateCheck(net, settings, { now: 1000, fetch: server().fetch });
        const pipeline = server({});
        const request = await requestUpdate(net, settings, hook, 'user:ada', { now: 2000, fetch: pipeline.fetch });
        expect(request).toEqual({ version: NEWER, requestedAt: 2000, requestedBy: 'user:ada' });
        expect(pipeline.requests).toHaveLength(1);
        const sent = pipeline.requests[0]!;
        expect(sent.url).toBe(hook.url);
        expect(sent.init?.method).toBe('POST');
        expect(new Headers(sent.init?.headers).get('authorization')).toBe('Bearer secret-token');
        // GitHub's repository_dispatch shape, which any pipeline can accept.
        expect(JSON.parse(String(sent.init?.body))).toEqual({ event_type: 'cossack-update', client_payload: { version: NEWER } });
        expect(await updateStatus(net, settings, hook, 2500)).toMatchObject({ request, hook: true, progressUrl: 'https://github.com/acme/site/actions' });
        // A second press while one is pending sends nothing.
        await expect(requestUpdate(net, settings, hook, 'user:ada', { now: 3000, fetch: pipeline.fetch })).rejects.toThrow('already requested');
        expect(pipeline.requests).toHaveLength(1);
        // The request ends after a day, or when a person clears it.
        expect(await pendingRequest(net, 2000 + DAY + 1)).toBeNull();
        await clearRequest(net);
        expect(await pendingRequest(net, 3000)).toBeNull();
    });

    it('refuses without a hook, without a newer version, and when the hook refuses', async () => {
        const { network: net } = network();
        await expect(requestUpdate(net, settings, null, 'user:ada')).rejects.toThrow('No update hook is set');
        const pipeline = server({});
        await expect(requestUpdate(net, settings, hook, 'user:ada', { fetch: pipeline.fetch })).rejects.toThrow('No newer version is known');
        expect(pipeline.requests).toEqual([]);
        await refreshUpdateCheck(net, settings, { now: 1000, fetch: server().fetch });
        const refusing = (async () => new Response('Bad credentials', { status: 401 })) as typeof globalThis.fetch;
        await expect(requestUpdate(net, settings, hook, 'user:ada', { now: 2000, fetch: refusing })).rejects.toThrow('The update hook answered 401');
        expect(await pendingRequest(net, 2000)).toBeNull();
    });

    it('asks for two steps when the latest version cannot be reached in one', async () => {
        const { network: net } = network();
        await refreshUpdateCheck(net, settings, { now: 1000, fetch: server({ latest: NEWER, minimumFrom: NEWER }).fetch });
        await expect(requestUpdate(net, settings, hook, 'user:ada', { now: 2000, fetch: server({}).fetch })).rejects.toThrow(`needs ${NEWER} first`);
    });
});
