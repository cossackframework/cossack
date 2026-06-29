import type {
    OAuthProviderConfig,
    OAuthProviderDefinition,
    OAuthUser,
    TokenSet,
    GoogleProviderOptions,
} from '../types';
import { createNormalizer, decodeJwtPayload } from '../provider';

export type { GoogleProviderOptions };

/**
 * Resolve Google-specific options from an `OAuthProviderConfig`. The config's
 * `provider` bag is typed via the {@link OAuthProviderConfig} generic.
 */
function optionsOf(config: OAuthProviderConfig<GoogleProviderOptions>): GoogleProviderOptions {
    return config.provider ?? {};
}

/**
 * Google OpenID Connect provider.
 *
 * Default scopes: `['openid', 'email', 'profile']`. Email/name/picture are
 * resolved from the `id_token` JWT claims (preferred for accuracy), with
 * fallback to the userinfo payload.
 */
export function createGoogleProvider(
    opts: GoogleProviderOptions = {},
): OAuthProviderDefinition {
    const issuerRoot = opts.issuer ?? 'https://accounts.google.com';
    const fallback = createNormalizer({
        id: 'sub',
        name: 'name',
        email: 'email',
        avatar: 'picture',
    });

    return {
        id: 'google',
        authorizeUrl: `${issuerRoot}/o/oauth2/v2/auth`,
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        scopes: ['openid', 'email', 'profile'],
        authorizeParams: (config) => {
            const params: Record<string, string> = {};
            const o = optionsOf(config as OAuthProviderConfig<GoogleProviderOptions>);
            if (o.hostedDomain) params.hd = o.hostedDomain;
            if (o.offlineAccess) {
                params.access_type = 'offline';
                params.prompt = 'consent';
            }
            return params;
        },
        normalizeUser: (raw, tokens: TokenSet): OAuthUser => {
            const claims = tokens.idToken ? decodeJwtPayload(tokens.idToken) : {};
            const merged: Record<string, unknown> = { ...raw, ...claims };
            // Prefer the stable subject claim from the id_token when present.
            if (typeof claims.sub === 'string') merged.id = claims.sub;
            return fallback(merged, tokens);
        },
    };
}
