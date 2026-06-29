import type { OAuthProviderDefinition, OAuthUser, TokenSet } from '../types';
import { createNormalizer } from '../provider';

/**
 * Facebook Graph API provider.
 *
 * Facebook's user-info endpoint only returns fields explicitly listed in a
 * `fields` query param. We request `id,name,email,picture`.
 *
 * Default scopes: `['email', 'public_profile']`. Graph API version is pinned
 * to v19.0 — adjust by overriding userInfoUrl via a custom provider if needed.
 */
const baseNormalize = createNormalizer({
    id: 'id',
    name: 'name',
    email: 'email',
});

function normalizeFacebook(raw: Record<string, unknown>, tokens: TokenSet): OAuthUser {
    const base = baseNormalize(raw, tokens);
    const picture = raw.picture as { data?: { url?: string } } | undefined;
    const avatar = picture?.data?.url;
    return { ...base, avatar, raw };
}

export const facebookProvider: OAuthProviderDefinition = {
    id: 'facebook',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/v19.0/me',
    scopes: ['email', 'public_profile'],
    userInfoParams: () => ({
        fields: 'id,name,email,picture.width(320).height(320)',
    }),
    normalizeUser: normalizeFacebook,
};
