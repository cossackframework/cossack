import type {
    OAuthProviderConfig,
    OAuthProviderDefinition,
    OAuthUser,
    TokenSet,
    MicrosoftProviderOptions,
} from '../types';
import { createNormalizer, decodeJwtPayload } from '../provider';

export type { MicrosoftProviderOptions };

function optionsOf(config: OAuthProviderConfig<MicrosoftProviderOptions>): MicrosoftProviderOptions {
    return config.provider ?? {};
}

/**
 * Microsoft (Azure AD v2.0 / OIDC) provider.
 *
 * Default scopes: `['openid', 'email', 'profile', 'User.Read']`. The `tenant`
 * option controls the authority (`common`, `organizations`, `consumers`, or a
 * GUID). Email/name are read from the `id_token` claims with userinfo fallback.
 * `email` comes only from the `email` claim, which Microsoft does not verify;
 * `emailVerified` is `true` only when the optional `xms_edov` claim is `true`.
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
            // Only the `email` claim is an email. `preferred_username` is a
            // UPN and Graph `mail` is admin-editable; neither proves ownership.
            const merged: Record<string, unknown> = {
                ...raw,
                ...claims,
                mail: claims.email ?? raw.email ?? null,
                displayName: claims.name ?? raw.displayName,
                id: claims.oid ?? claims.sub ?? raw.id,
            };
            const user = fallback(merged, tokens);
            // `xms_edov` (optional claim) asserts the email domain is verified
            // by the tenant. Without it the `email` claim is unverified.
            return { ...user, emailVerified: !!user.email && claims.xms_edov === true };
        },
    };
}
