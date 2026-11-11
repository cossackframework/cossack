import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (text: string) => text);
vi.stubGlobal('config', () => '/dashboard');
const spent = vi.hoisted(() => ({ magic: 0, verify: 0 }));
vi.mock('../src/auth', () => ({
    TWO_FACTOR_COOKIE: 'cms_2fa',
    SignInPasskeyError: class extends Error {},
    beginTwoFactor: async () => null,
    consumeMagicLink: async () => { spent.magic++; return 'user-1'; },
    verifyEmail: async () => { spent.verify++; return { user: 'user-1', pending: false }; },
    authSessions: { create: async () => ({ headers: new Headers({ 'set-cookie': 'session=1' }) }) },
}));
vi.mock('../src/cms/index', () => ({ networkFor: () => ({}), siteUrl: () => undefined }));

const { default: MagicLinkPage } = await import('../src/pages/auth/magic/index');
const { default: VerifyPage } = await import('../src/pages/auth/verify/index');

const TOKEN = 'a'.repeat(40);

function context() {
    const headers = new Map<string, string>();
    return { headers, req: { url: 'https://site.example/auth/magic', query: (name: string) => name === 'token' ? TOKEN : undefined }, status: () => undefined, header: (key: string, value: string) => headers.set(key, value) };
}

describe('email link pages', () => {
    it('spend a link and sign in only on the confirming request, never on opening it', async () => {
        for (const [Page, kind, action] of [[MagicLinkPage, 'magic', 'signIn'], [VerifyPage, 'verify', 'confirm']] as const) {
            const page = new (Page as unknown as new () => Record<string, unknown>)();
            const c = context();
            Object.defineProperty(page, 'c', { value: c, configurable: true });
            page.redirect = vi.fn();
            await (page.init as () => Promise<void>).call(page);
            expect(spent[kind]).toBe(0);
            expect(c.headers.size).toBe(0);
            expect(page.token).toBe(TOKEN);
            await (page[action] as (token: string) => Promise<void>).call(page, TOKEN);
            expect(spent[kind]).toBe(1);
            expect(c.headers.get('set-cookie')).toBe('session=1');
            expect(page.redirect).toHaveBeenCalled();
        }
    });
});
