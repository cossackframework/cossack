import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CMS_VERSION, checkForUpdate, compareVersions, parseUpdateAnswer, updateCheckUrl, type UpdateCheck } from '../src/index';

const respond = (body: unknown, status = 200) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the update check', () => {
    it('knows the version of its own package', () => {
        expect(CMS_VERSION).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
    });

    it('orders versions, with a pre-release before its release', () => {
        expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareVersions('1.0.0-canary.2', '1.0.0')).toBeLessThan(0);
        expect(compareVersions('1.0.0-canary.10', '1.0.0-canary.9')).toBeGreaterThan(0);
        expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0);
        expect(compareVersions('1.0.0+build', '1.0.0')).toBe(0);
        expect(compareVersions('latest', '1.0.0')).toBeNull();
        expect(compareVersions('1.0', '1.0.0')).toBeNull();
    });

    it('sends the installed version and the channel, and nothing else', () => {
        expect(updateCheckUrl({ url: 'https://cms.cossack.dev/update', channel: 'latest' }, '0.9.0')).toBe('https://cms.cossack.dev/update?version=0.9.0&channel=latest');
    });

    it('accepts only a valid version that is newer than the installed one', () => {
        expect(parseUpdateAnswer({ latest: '0.10.0', published: '2026-12-01T00:00:00Z', notes: 'https://cossack.dev/releases/0.10.0', security: true, hostTemplate: '0.10.0', minimumFrom: '0.9.0', extra: 'ignored' }, '0.9.0'))
            .toEqual({ latest: '0.10.0', published: '2026-12-01T00:00:00Z', notes: 'https://cossack.dev/releases/0.10.0', security: true, hostTemplate: '0.10.0', minimumFrom: '0.9.0' });
        expect(parseUpdateAnswer({ latest: '0.9.0' }, '0.9.0')).toBeNull();
        expect(parseUpdateAnswer({ latest: '0.8.0' }, '0.9.0')).toBeNull();
        expect(parseUpdateAnswer({ latest: 'newest' }, '0.9.0')).toBeNull();
        expect(parseUpdateAnswer(['0.10.0'], '0.9.0')).toBeNull();
        expect(parseUpdateAnswer(null, '0.9.0')).toBeNull();
        // Fields that are not what they should be are left out, never shown.
        expect(parseUpdateAnswer({ latest: '0.10.0', notes: 'javascript:alert(1)', published: 'soon', security: 'yes', hostTemplate: 'x', minimumFrom: 3 }, '0.9.0')).toEqual({ latest: '0.10.0', security: false });
    });

    it('asks the server and keeps a newer version', async () => {
        const requests: string[] = [];
        const check = await checkForUpdate({ installed: '0.9.0', url: 'https://updates.test/update', channel: 'latest', now: 1000,
            fetch: async (input, init) => { requests.push(String(input)); expect(new Headers(init?.headers).get('cookie')).toBeNull(); return respond({ latest: '0.10.0', security: false })(); } });
        expect(requests).toEqual(['https://updates.test/update?version=0.9.0&channel=latest']);
        expect(check).toEqual({ checkedAt: 1000, installed: '0.9.0', channel: 'latest', available: { latest: '0.10.0', security: false } });
        expect((await checkForUpdate({ installed: '0.10.0', url: 'https://updates.test/update', channel: 'latest', now: 2000, fetch: respond({ latest: '0.10.0' }) })).available).toBeNull();
    });

    it('keeps the earlier answer when the server is down or answers nonsense', async () => {
        const previous: UpdateCheck = { checkedAt: 1000, installed: '0.9.0', channel: 'latest', available: { latest: '0.10.0', security: true } };
        const down = await checkForUpdate({ installed: '0.9.0', url: 'https://updates.test/update', channel: 'latest', now: 2000, previous, fetch: async () => { throw new Error('connect ECONNREFUSED'); } });
        expect(down).toEqual({ checkedAt: 2000, installed: '0.9.0', channel: 'latest', available: previous.available, error: 'connect ECONNREFUSED' });
        const failing = await checkForUpdate({ installed: '0.9.0', url: 'https://updates.test/update', channel: 'latest', now: 2000, previous, fetch: respond('oops', 503) });
        expect(failing).toMatchObject({ available: previous.available, error: 'The update server answered 503.' });
        const garbled = await checkForUpdate({ installed: '0.9.0', url: 'https://updates.test/update', channel: 'latest', now: 2000, previous, fetch: respond('<html>') });
        expect(garbled.available).toEqual(previous.available);
        expect(garbled.error).toBeTruthy();
        // After the site was updated, the earlier answer names nothing newer.
        const updated = await checkForUpdate({ installed: '0.10.0', url: 'https://updates.test/update', channel: 'latest', now: 3000, previous, fetch: async () => { throw new Error('down'); } });
        expect(updated.available).toBeNull();
    });
});
