import type {
    OAuthProviderConfig,
    OAuthProviderDefinition,
    OAuthUser,
    TokenSet,
} from '../types';
import { createNormalizer, decodeJwtPayload } from '../provider';

export interface MicrosoftProviderOptions {
    /**
     * Azure AD tenant. One of:
     *  - `'common'` (default) — any Microsoft account
     *  - `'organizations'` — work/school only
     *  - `'consumers'` — personal Microsoft accounts only
     *  - a tenant GUID or verified domain name — a single tenant
     */
    tenant?: string;
}

function optionsOf(config: OAuthProviderConfig): MicrosoftProviderOptions {
    return ((config as OAuthProviderConfig & { provider?: MicrosoftProviderOptions }).provider) ?? {};
}

/**
 * Microsoft (Azure AD v2.0 / OIDC) provider.
 *
 * Default scopes: `['openid', 'email', 'profile', 'User.Read']`. The `tenant`
 * option controls the authority (`common`, `organizations`, `consumers`, or a
 * GUID). Email/name are read from the `id_token` claims with userinfo fallback.
 */
export function createMicrosoftProvider(
    opts: MicrosoftProviderOptions = {},
): OAuthProviderDefinition {
    const tenant = opts.tenant ?? 'common';
    const authority = `https://login.microsoftonline.com/${tenant}`;
    const fallback = createNormalizer({
        id: 'id',
        name: 'displayName',
        email: 'mail',
        avatar: 'thumbnailPhoto',
    });

    return {
        id: 'microsoft',
        authorizeUrl: `${authority}/oauth2/v2.0/authorize`,
        tokenUrl: `${authority}/oauth2/v2.0/token`,
        userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
        scopes: ['openid', 'email', 'profile', 'User.Read'],
        normalizeUser: (raw, tokens: TokenSet): OAuthUser => {
            const claims = tokens.idToken ? decodeJwtPayload(tokens.idToken) : {};
            // Prefer email/surname claims from the id_token; Microsoft's
            // preferred_username is the most reliable email source.
            const merged: Record<string, unknown> = {
                ...raw,
                ...claims,
                mail: claims.email ?? claims.preferred_username ?? claims.mail ?? raw.mail,
                displayName: claims.name ?? raw.displayName,
                id: claims.oid ?? claims.sub ?? raw.id,
            };
            return fallback(merged, tokens);
        },
    };
}
