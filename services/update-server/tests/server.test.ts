import { describe, expect, it } from 'vitest';
import { parseUpdateAnswer } from '@cossackframework/cms/updates';
import { updateAnswer, type ReleaseList } from '../src/answer';
import worker, { handle } from '../src/index';

const list: ReleaseList = { channels: {
    latest: [
        { version: '0.9.0', published: '2026-11-13T00:00:00Z', notes: 'https://example.com/0.9.0' },
        { version: '0.9.1', security: true },
        { version: '0.10.0', published: '2026-12-01T00:00:00Z', notes: 'https://example.com/0.10.0', hostTemplate: '0.10.0' },
        { version: '0.11.0', published: '2027-01-10T00:00:00Z', notes: 'https://example.com/0.11.0', minimumFrom: '0.10.0' },
        { version: 'not-a-version' },
    ],
    canary: [{ version: '0.12.0-canary.2' }, { version: '0.12.0-canary.10' }],
} };
const get = (query: string, init?: RequestInit) => handle(new Request(`https://cms.cossack.dev/update${query}`, init), list);

describe('the update server', () => {
    it('names the latest version of the channel, whatever order the list is in', () => {
        expect(updateAnswer(list, '0.11.0', 'latest')).toEqual({ channel: 'latest', latest: '0.11.0', published: '2027-01-10T00:00:00Z', notes: 'https://example.com/0.11.0', security: false });
        expect(updateAnswer(list, '0.12.0-canary.2', 'canary')?.latest).toBe('0.12.0-canary.10');
        expect(updateAnswer(list, '0.9.0', 'nightly')).toBeNull();
    });

    it('says security when any release the site would skip fixes a security problem', () => {
        expect(updateAnswer(list, '0.9.0', 'latest')?.security).toBe(true);
        expect(updateAnswer(list, '0.9.1', 'latest')?.security).toBe(false);
    });

    it('names the version to reach first when the latest cannot be reached in one step', () => {
        expect(updateAnswer(list, '0.9.0', 'latest')?.minimumFrom).toBe('0.10.0');
        expect(updateAnswer(list, '0.10.0', 'latest')?.minimumFrom).toBeUndefined();
    });

    it('answers GET /update with JSON that shared caches may keep, and sets no cookie', async () => {
        const response = get('?version=0.9.0&channel=latest');
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
        expect(response.headers.get('set-cookie')).toBeNull();
        const body = await response.json();
        expect(body).toEqual({ channel: 'latest', latest: '0.11.0', published: '2027-01-10T00:00:00Z', notes: 'https://example.com/0.11.0', security: true, minimumFrom: '0.10.0' });
        // The CMS accepts exactly this answer.
        expect(parseUpdateAnswer(body, '0.9.0')).toEqual({ latest: '0.11.0', published: '2027-01-10T00:00:00Z', notes: 'https://example.com/0.11.0', security: true, minimumFrom: '0.10.0' });
        // The channel defaults to latest, and HEAD has no body.
        expect((await get('?version=0.11.0').json() as { latest: string }).latest).toBe('0.11.0');
        const head = get('?version=0.9.0', { method: 'HEAD' });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe('');
    });

    it('refuses what is not a version, a channel or a GET', async () => {
        expect(get('').status).toBe(400);
        expect(get('?version=latest').status).toBe(400);
        expect(get(`?version=${'1'.repeat(80)}.0.0`).status).toBe(400);
        expect(get('?version=0.9.0&channel=../etc').status).toBe(400);
        expect(get('?version=0.9.0&channel=nightly').status).toBe(404);
        const post = get('?version=0.9.0', { method: 'POST' });
        expect(post.status).toBe(405);
        expect(post.headers.get('allow')).toBe('GET, HEAD');
        expect(handle(new Request('https://cms.cossack.dev/'), list).status).toBe(404);
        // An error never names what was asked.
        expect(await get('?version=<script>').text()).not.toContain('<script>');
    });

    it('serves the bundled release list', async () => {
        const response = await worker.fetch(new Request('https://cms.cossack.dev/update?version=0.0.1'));
        expect(response.status).toBe(200);
        expect((await response.json() as { latest: string }).latest).toMatch(/^\d+\.\d+\.\d+/);
    });
});
