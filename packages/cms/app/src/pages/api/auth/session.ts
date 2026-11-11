import type { Context } from 'hono';
import { isSameOriginPost } from '@cossackframework/cms';
import { passesBotCheck } from '../../../auth-bot-check';
import { auth, completeTwoFactor, beginTwoFactor, loginUser, logout, SignInLockedError, SignInPasskeyError } from '../../../auth';

/**
 * JSON sign-in for tools such as `cossack <plugin>:<command>`: `{ email, password }` answers
 * with the session cookie. Accounts with an authenticator app also send `code`; without it the
 * answer is 401 `{ twoFactorRequired: true }`. While the Turnstile bot check is on, `turnstile`
 * carries its token (403 `CMS_BOT_CHECK` without one). The auth kit refuses cross-site requests and
 * non-JSON bodies.
 */
export const POST = auth.createLoginHandler({
    validateCredentials: async credentials => {
        const { email, password, code, turnstile } = credentials as { email?: unknown; password?: unknown; code?: unknown; turnstile?: unknown };
        if (typeof email !== 'string' || typeof password !== 'string') return null;
        // The sign-in form's bot check guards this door too; tools sign in with an application password instead.
        if (!(await passesBotCheck(turnstile, 'login'))) return Response.json({ error: 'This site checks sign-ins for bots: send a Turnstile token as `turnstile`, or use an application password (`--token`).', code: 'CMS_BOT_CHECK' }, { status: 403 });
        let user: Awaited<ReturnType<typeof loginUser>>;
        try { user = await loginUser(email, password); }
        catch (error) {
            if (!(error instanceof SignInLockedError)) throw error;
            return Response.json({ error: error.message, code: 'CMS_RATE_LIMITED' }, { status: 429, headers: { 'retry-after': String(Math.ceil(error.retryAfterMs / 1000)) } });
        }
        if (!user) return null;
        let pending: string | null;
        try { pending = await beginTwoFactor(user.id); }
        catch (error) {
            if (!(error instanceof SignInPasskeyError)) throw error;
            return Response.json({ error: error.message, code: 'CMS_PASSKEY_REQUIRED' }, { status: 401 });
        }
        if (!pending) return user;
        if (typeof code !== 'string' || !code.trim()) return Response.json({ error: 'Enter the code from your authenticator app.', twoFactorRequired: true }, { status: 401 });
        const result = await completeTwoFactor(pending, code);
        return 'user' in result ? result.user : Response.json({ error: result.error, twoFactorRequired: true }, { status: 401 });
    },
});

/** End the session the cookie names: `DELETE /api/auth/session`, same-origin, for tools that signed in to create an application password. */
export const DELETE = async (c: Context) => {
    if (!c.get('user')) return c.json({ error: 'No session.', code: 'CMS_UNAUTHENTICATED' }, 401);
    if (!isSameOriginPost(c.req.raw)) return c.json({ error: 'Cross-site requests are not allowed.', code: 'CMS_FORBIDDEN' }, 403);
    const { headers } = await logout(c);
    return new Response(null, { status: 204, headers });
};
