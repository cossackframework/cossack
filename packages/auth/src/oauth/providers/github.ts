import type { OAuthProviderDefinition, OAuthUser, TokenSet } from '../types';
import { createNormalizer } from '../provider';

/**
 * GitHub OAuth user-info email fallback.
 *
 * GitHub returns `email: null` when the user has marked their email as private.
 * If the `user:email` scope was requested, the primary/verified address can be
 * fetched from the `/user/emails` endpoint.
 */
async function resolveEmail(
    raw: Record<string, unknown>,
    tokens: TokenSet,
): Promise<string | null | undefined> {
    if (typeof raw.email === 'string' && raw.email.length > 0) return raw.email;

    const response = await fetch('https://api.github.com/user/emails', {
        headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: 'application/vnd.github+json',
        },
    });
    if (!response.ok) return null;
    const emails = (await response.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
    }>;
    const primary = emails.find((e) => e.primary && e.verified) ?? emails[0];
    return primary?.email ?? null;
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
 * Default scopes: `['user:email']` — enough to resolve email even when hidden.
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
        return { ...user, email };
    },
};
