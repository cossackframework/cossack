import type { OAuthProviderDefinition, OAuthUser, TokenSet } from './types';

/**
 * Helper for declaring a custom OAuth 2.0 provider. Pure type passthrough —
 * documents intent and gives a single import surface for community providers.
 *
 * @example
 * ```ts
 * const discord = defineOAuthProvider({
 *   id: 'discord',
 *   authorizeUrl: 'https://discord.com/oauth2/authorize',
 *   tokenUrl: 'https://discord.com/api/oauth2/token',
 *   userInfoUrl: 'https://discord.com/api/users/@me',
 *   scopes: ['identify', 'email'],
 *   normalizeUser: (raw) => ({
 *     id: String(raw.id),
 *     nickname: raw.username as string,
 *     email: raw.email as string | null,
 *     avatar: raw.avatar
 *       ? `https://cdn.discordapp.com/avatars/${raw.id}/${raw.avatar}.png`
 *       : undefined,
 *     raw,
 *   }),
 * });
 * ```
 */
export function defineOAuthProvider(definition: OAuthProviderDefinition): OAuthProviderDefinition {
    return definition;
}

/**
 * Decode the payload of a JWT (id_token) without verifying its signature.
 *
 * Signature verification is intentionally skipped: by the time we decode an
 * `id_token`, it was obtained directly from the provider's token endpoint over
 * TLS, so we trust its provenance. (OIDC spec recommends verifying, but for
 * a non-OIDC-library convenience layer this is an acceptable trade-off and is
 * the same approach Laravel Socialite takes.) Returns `{}` on any parse error.
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
    try {
        const parts = jwt.split('.');
        if (parts.length < 2) return {};
        const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/**
 * Build a normalizer that maps fields from a raw provider payload by key,
 * falling back to sensible defaults. Useful for first-party providers whose
 * response shape is stable.
 */
export interface FieldMap {
    id?: string;
    nickname?: string;
    name?: string;
    email?: string;
    avatar?: string;
}

export function createNormalizer(
    fieldMap: FieldMap,
): (raw: Record<string, unknown>, _tokens: TokenSet) => OAuthUser {
    return (raw: Record<string, unknown>) => ({
        id: String(raw[fieldMap.id ?? 'id'] ?? ''),
        nickname: pickString(raw, fieldMap.nickname ?? 'nickname'),
        name: pickString(raw, fieldMap.name ?? 'name'),
        email: pickOptionalString(raw, fieldMap.email ?? 'email'),
        avatar: pickString(raw, fieldMap.avatar ?? 'avatar'),
        raw,
    });
}

function pickString(raw: Record<string, unknown>, key: string): string | undefined {
    const value = raw[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickOptionalString(
    raw: Record<string, unknown>,
    key: string,
): string | null | undefined {
    const value = raw[key];
    if (value === null) return null;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
