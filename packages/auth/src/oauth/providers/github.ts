import type { OAuthProviderDefinition, OAuthUser, TokenSet } from '../types';
import { createNormalizer } from '../provider';

/**
 * Resolve a verified GitHub email.
 *
 * The `/user` payload does not say whether its `email` is verified, and users
 * can add unverified secondary addresses. Every address is therefore checked
 * against `/user/emails` (needs the `user:email` scope): the profile email if
 * it is listed as verified, else the verified primary, else `null`.
 */
async function resolveEmail(
    raw: Record<string, unknown>,
    tokens: TokenSet,
): Promise<string | null> {
    const response = await fetch('https://api.github.com/user/emails', {
        headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: 'application/vnd.github+json',
        },
    });
    if (!response.ok) return null;
    const emails: unknown = await response.json();
    if (!Array.isArray(emails)) return null;
    const verified = emails.filter((e): e is { email: string; primary?: boolean; verified: true } =>
        !!e && typeof e === 'object' && typeof e.email === 'string' && e.email.length > 0 && e.verified === true);
    const profile = typeof raw.email === 'string' ? verified.find((e) => e.email === raw.email) : undefined;
    return (profile ?? verified.find((e) => e.primary === true))?.email ?? null;
}

const base = createNormalizer({
    id: 'id',
    nickname: 'login',
    name: 'name',
    email: 'email',
    avatar: 'avatar_url',
});

/**
 * GitHub OAuth App provider definition.
 *
 * Default scopes: `['user:email']` — required to confirm that an email is
 * verified. Without it, `email` is `null`.
 */
export const githubProvider: OAuthProviderDefinition = {
    id: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['user:email'],
    normalizeUser: async (raw, tokens): Promise<OAuthUser> => {
        const user = base(raw, tokens);
        const email = await resolveEmail(raw, tokens);
        return { ...user, email, emailVerified: email !== null };
    },
};
