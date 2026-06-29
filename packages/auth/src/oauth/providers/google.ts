import type {
    OAuthProviderConfig,
    OAuthProviderDefinition,
    OAuthUser,
    TokenSet,
} from '../types';
import { createNormalizer, decodeJwtPayload } from '../provider';

export interface GoogleProviderOptions {
    /**
     * Hosted-domain hint (`hd`). Restricts sign-in to a specific Google Workspace
     * domain; passed as the `hd` authorize param. Users outside the domain are
     * shown an error by Google.
     */
    hostedDomain?: string;
    /**
     * Whether to request a refresh token. Sets `access_type=offline` and
     * `prompt=consent` on the authorize request.
     */
    offlineAccess?: boolean;
    /**
     * Custom OpenID Connect issuer URL. Defaults to Google's public issuer.
     * Override only for restricted/sovereign-cloud setups.
     */
    issuer?: string;
}

/**
 * Resolve Google-specific options from an `OAuthProviderConfig`. Callers stash
 * provider options on the config object via casting; this is a typed accessor.
 */
function optionsOf(config: OAuthProviderConfig): GoogleProviderOptions {
    return ((config as OAuthProviderConfig & { provider?: GoogleProviderOptions }).provider) ?? {};
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
            const o = optionsOf(config);
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
