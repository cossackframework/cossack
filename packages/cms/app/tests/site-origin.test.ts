import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('__', (text: string) => text);

const { mailOrigin, siteOrigin } = await import('../src/cms/seo');
const { localAddress } = await import('../src/cms/index');

const context = (url: string, env: Record<string, string>, site?: { id: string; host?: string }) =>
    ({ req: { url }, env, get: (key: string) => key === 'site' ? site : undefined }) as unknown as Context;

describe('a site\'s own address', () => {
    it('is APP_URL on the main site and an added site\'s domain on that site, never the request\'s host', () => {
        const env = { APP_URL: 'https://network.example/' };
        expect(siteOrigin(context('https://attacker.example/x', env, { id: 'main' }))).toBe('https://network.example');
        expect(siteOrigin(context('https://blog.example/x', env, { id: 'blog', host: 'blog.example' }))).toBe('https://blog.example');
        // Development keeps the network's scheme and port.
        expect(siteOrigin(context('http://blog.localhost:5173/x', { APP_URL: 'http://localhost:5173' }, { id: 'blog', host: 'blog.localhost' }))).toBe('http://blog.localhost:5173');
        // Without any address, the request's own origin.
        expect(siteOrigin(context('http://localhost:3000/x', {}))).toBe('http://localhost:3000');
        // An added site without APP_URL, on its own host: the request's scheme and port, not a guessed https.
        expect(siteOrigin(context('http://blog.localhost:5173/x', {}, { id: 'blog', host: 'blog.localhost' }))).toBe('http://blog.localhost:5173');
        // Reached through another host (the network's API), its domain as configured.
        expect(siteOrigin(context('http://localhost:5173/api/x', {}, { id: 'blog', host: 'blog.example' }))).toBe('https://blog.example');
    });

    it('builds email links from a configured address, or the request\'s only on this machine', () => {
        expect(mailOrigin(context('https://attacker.example/x', { APP_URL: 'https://network.example' }, { id: 'main' }))).toBe('https://network.example');
        // Without APP_URL, a Host header the client chose names no link.
        expect(mailOrigin(context('https://attacker.example/x', {}, { id: 'main' }))).toBeNull();
        expect(mailOrigin(context('http://localhost:3000/x', {}))).toBe('http://localhost:3000');
        expect(mailOrigin(context('http://blog.localhost:5173/x', {}, { id: 'blog', host: 'blog.localhost' }))).toBe('http://blog.localhost:5173');
    });

    it('lets webhooks stay local only when APP_URL names this machine', () => {
        expect(localAddress(undefined)).toBe(false);
        expect(localAddress('')).toBe(false);
        expect(localAddress('not a url')).toBe(false);
        expect(localAddress('https://site.example')).toBe(false);
        expect(localAddress('http://localhost:5173')).toBe(true);
        expect(localAddress('http://127.0.0.1:8787')).toBe(true);
        expect(localAddress('http://shop.localhost')).toBe(true);
    });
});
