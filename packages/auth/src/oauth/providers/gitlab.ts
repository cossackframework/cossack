import type {
    OAuthProviderDefinition,
    OAuthUser,
    TokenSet,
} from '../types';
import { createNormalizer } from '../provider';

export interface GitLabProviderOptions {
    /**
     * Base URL of the GitLab instance. Defaults to `https://gitlab.com`.
     * Override for self-hosted GitLab (e.g. `https://gitlab.example.com`).
     */
    baseUrl?: string;
}

/**
 * GitLab OAuth2 provider.
 *
 * Default scopes: `['read_user']`. Email is resolved via the `/user/emails`
 * fallback when not present in the user payload (same as GitHub).
 */
export function createGitLabProvider(opts: GitLabProviderOptions = {}): OAuthProviderDefinition {
    const root = (opts.baseUrl ?? 'https://gitlab.com').replace(/\/$/, '');
    const base = createNormalizer({
        id: 'id',
        nickname: 'username',
        name: 'name',
        email: 'email',
        avatar: 'avatar_url',
    });

    async function resolveEmail(
        raw: Record<string, unknown>,
        tokens: TokenSet,
    ): Promise<string | null | undefined> {
        if (typeof raw.email === 'string' && raw.email.length > 0) return raw.email;
        const response = await fetch(`${root}/api/v4/user/emails`, {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!response.ok) return null;
        const emails = (await response.json()) as Array<{ email: string; confirmed: boolean }>;
        const confirmed = emails.find((e) => e.confirmed) ?? emails[0];
        return confirmed?.email ?? null;
    }

    return {
        id: 'gitlab',
        authorizeUrl: `${root}/oauth/authorize`,
        tokenUrl: `${root}/oauth/token`,
        userInfoUrl: `${root}/api/v4/user`,
        scopes: ['read_user'],
        normalizeUser: async (raw, tokens): Promise<OAuthUser> => {
            const user = base(raw, tokens);
            const email = await resolveEmail(raw, tokens);
            return { ...user, email };
        },
    };
}
