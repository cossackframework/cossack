import type {
    OAuthProviderConfig,
    OAuthProviderDefinition,
    OAuthUser,
    TokenSet,
    GitLabProviderOptions,
} from '../types';
import { createNormalizer } from '../provider';

export type { GitLabProviderOptions };

function isConfirmed(record: Record<string, unknown>): boolean {
    return (typeof record.confirmed_at === 'string' && record.confirmed_at.length > 0) || record.confirmed === true;
}

/**
 * GitLab OAuth2 provider.
 *
 * Default scopes: `['read_user']`. Only confirmed addresses are returned: the
 * primary email of a confirmed account, else a confirmed `/user/emails` entry.
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

    /**
     * The primary `email` is used only when the account is confirmed
     * (`confirmed_at`). Otherwise the first confirmed secondary address from
     * `/user/emails` is used. Unconfirmed addresses are never returned.
     */
    async function resolveEmail(
        raw: Record<string, unknown>,
        tokens: TokenSet,
    ): Promise<string | null> {
        if (typeof raw.email === 'string' && raw.email.length > 0 && isConfirmed(raw)) return raw.email;
        const response = await fetch(`${root}/api/v4/user/emails`, {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!response.ok) return null;
        const emails: unknown = await response.json();
        if (!Array.isArray(emails)) return null;
        const confirmed = emails.find((e): e is { email: string } =>
            !!e && typeof e === 'object' && typeof e.email === 'string' && e.email.length > 0 && isConfirmed(e));
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
            return { ...user, email, emailVerified: email !== null };
        },
    };
}
