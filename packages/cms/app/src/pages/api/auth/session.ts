import { auth, completeTwoFactor, beginTwoFactor, loginUser } from '../../../auth';

/**
 * JSON sign-in for tools such as `cossack <plugin>:<command>`: `{ email, password }` answers
 * with the session cookie. Accounts with an authenticator app also send `code`; without it the
 * answer is 401 `{ twoFactorRequired: true }`. The auth kit refuses cross-site requests and
 * non-JSON bodies.
 */
export const POST = auth.createLoginHandler({
    validateCredentials: async credentials => {
        const { email, password, code } = credentials as { email?: unknown; password?: unknown; code?: unknown };
        if (typeof email !== 'string' || typeof password !== 'string') return null;
        const user = await loginUser(email, password);
        if (!user) return null;
        const pending = await beginTwoFactor(user.id);
        if (!pending) return user;
        if (typeof code !== 'string' || !code.trim()) return Response.json({ error: 'Enter the code from your authenticator app.', twoFactorRequired: true }, { status: 401 });
        const result = await completeTwoFactor(pending, code);
        return 'user' in result ? result.user : Response.json({ error: result.error, twoFactorRequired: true }, { status: 401 });
    },
});
