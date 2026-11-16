import { describe, expect, it, vi } from 'vitest';

const { passes, loginUser } = vi.hoisted(() => ({ passes: vi.fn(), loginUser: vi.fn() }));
vi.mock('../src/auth-bot-check', () => ({ passesBotCheck: passes }));
vi.mock('../src/auth', () => ({
    // The handler's credential check, called directly.
    auth: { createLoginHandler: ({ validateCredentials }: { validateCredentials: unknown }) => validateCredentials },
    loginUser, beginTwoFactor: async () => null, completeTwoFactor: vi.fn(), logout: vi.fn(),
    SignInLockedError: class extends Error {}, SignInPasskeyError: class extends Error {},
}));

const { POST } = await import('../src/pages/api/auth/session');
const signIn = POST as unknown as (credentials: Record<string, unknown>) => Promise<unknown>;

describe('JSON sign-in', () => {
    it('takes the sign-in form\'s bot check before the password', async () => {
        loginUser.mockResolvedValue({ id: 'u1' });
        passes.mockResolvedValue(false);
        const refused = await signIn({ email: 'a@example.com', password: 'pw', turnstile: 'bad' }) as Response;
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({ code: 'CMS_BOT_CHECK' });
        expect(passes).toHaveBeenCalledWith('bad', 'login');
        expect(loginUser).not.toHaveBeenCalled();
        passes.mockResolvedValue(true);
        expect(await signIn({ email: 'a@example.com', password: 'pw', turnstile: 'good' })).toEqual({ id: 'u1' });
    });
});
