import type { Context } from 'hono';
import type { OAuthProviderConfig, OAuthProviderDefinition, TokenSet } from './types';

const RESERVED_AUTHORIZE_KEYS = new Set([
    'state',
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'code_challenge',
    'code_challenge_method',
]);

/**
 * Resolve a possibly-relative redirect URL against the incoming request origin.
 */
export function resolveRedirectUrl(redirectUrl: string, c: Context): string {
    try {
        // Absolute already (with protocol) -> use as-is.
        // biome-ignore lint/correctness/useUnusedVariables: instanceof URL check
        // eslint-disable-next-line no-new
        new URL(redirectUrl);
        return redirectUrl;
    } catch {
        // relative; resolve against request origin
    }
    const req = c.req.raw;
    const origin = new URL(req.url).origin;
    return new URL(redirectUrl, origin).toString();
}

export interface BuildAuthorizeUrlArgs {
    definition: OAuthProviderDefinition;
    config: OAuthProviderConfig;
    redirectUrl: string;
    state: string;
    /** When provided, adds `code_challenge` + `code_challenge_method=S256`. Omit to disable PKCE. */
    codeChallenge?: string;
}

/**
 * Build the provider authorize URL with all standard OAuth 2.0 params plus
 * optional PKCE (S256) and any provider-specific extras.
 */
export function buildAuthorizeUrl(args: BuildAuthorizeUrlArgs): string {
    const { definition, config, redirectUrl, state, codeChallenge } = args;
    const url = new URL(definition.authorizeUrl);
    const separator = definition.scopeSeparator ?? ' ';
    const scopes = config.scopes ?? definition.scopes ?? [];

    const baseParams: Record<string, string> = {
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: redirectUrl,
        state,
    };
    // PKCE is opt-in per request: only the handler that can recover the
    // verifier (i.e. has a cookie store) sets a challenge.
    if (codeChallenge) {
        baseParams.code_challenge = codeChallenge;
        baseParams.code_challenge_method = 'S256';
    }
    if (scopes.length > 0) {
        baseParams.scope = scopes.join(separator);
    }

    const extras = definition.authorizeParams?.(config) ?? {};
    for (const [key, value] of Object.entries(extras)) {
        if (RESERVED_AUTHORIZE_KEYS.has(key)) continue;
        baseParams[key] = value;
    }

    for (const [key, value] of Object.entries(baseParams)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

export interface ExchangeCodeArgs {
    definition: OAuthProviderDefinition;
    config: OAuthProviderConfig;
    redirectUrl: string;
    code: string;
    /** Required when the authorize request was sent with a `code_challenge`; omit to skip PKCE. */
    codeVerifier?: string;
}

/**
 * Exchange an authorization code for a {@link TokenSet}. Performs a server-side
 * `application/x-www-form-urlencoded` POST to the provider's token endpoint.
 * Throws on non-2xx or malformed response.
 */
export async function exchangeCode(args: ExchangeCodeArgs): Promise<TokenSet> {
    const { definition, config, redirectUrl, code, codeVerifier } = args;

    const body: Record<string, string> = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUrl,
        client_id: config.clientId,
        client_secret: config.clientSecret,
    };
    // Only include the PKCE verifier when the authorize request was sent with
    // a matching challenge. Sending an empty/missing verifier to a provider
    // that expects one causes a hard failure.
    if (codeVerifier) {
        body.code_verifier = codeVerifier;
    }
    const extras = definition.tokenParams?.(config) ?? {};
    for (const [key, value] of Object.entries(extras)) {
        body[key] = value;
    }

    const response = await fetch(definition.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: new URLSearchParams(body).toString(),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(
            `OAuth token exchange failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
        );
    }

    return parseTokenResponse(await response.text());
}

/**
 * Parse the token endpoint response into a {@link TokenSet}. Handles both JSON
 * and (rare) form-encoded responses.
 */
export function parseTokenResponse(body: string): TokenSet {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
        // form-encoded fallback
        const params = new URLSearchParams(body);
        parsed = Object.fromEntries(params.entries());
    }

    const accessToken = parsed.access_token;
    if (typeof accessToken !== 'string') {
        throw new Error('OAuth token exchange: missing access_token in response');
    }

    return {
        accessToken,
        refreshToken: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : undefined,
        // Some providers (and all form-encoded responses) return expires_in as
        // a string; coerce both forms to a number.
        expiresIn: coerceNumber(parsed.expires_in),
        tokenType: typeof parsed.token_type === 'string' ? parsed.token_type : undefined,
        scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
        idToken: typeof parsed.id_token === 'string' ? parsed.id_token : undefined,
    };
}

/**
 * Coerce a token-response field to a finite number. Accepts numbers and
 * numeric strings; returns `undefined` for anything else (including `null`,
 * empty strings, and non-numeric values).
 */
function coerceNumber(value: unknown): number | undefined {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

export interface FetchUserInfoArgs {
    definition: OAuthProviderDefinition;
    tokens: TokenSet;
}

/**
 * Fetch the user profile from the provider's user-info endpoint using the
 * access token as a bearer credential, then run the provider's normalizer.
 */
export async function fetchUserInfo(args: FetchUserInfoArgs): Promise<{
    raw: Record<string, unknown>;
    user: import('./types').OAuthUser;
}> {
    const { definition, tokens } = args;
    const url = new URL(definition.userInfoUrl);

    const extras = definition.userInfoParams?.() ?? {};
    for (const [key, value] of Object.entries(extras)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(
            `OAuth user-info fetch failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
        );
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const user = await definition.normalizeUser(raw, tokens);
    return { raw, user };
}
