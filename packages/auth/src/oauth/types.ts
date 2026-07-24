import type { Context } from 'hono';

/**
 * Normalized representation of an authenticated user returned by an OAuth
 * provider. Mirrors the shape popularized by Laravel Socialite so the
 * developer-facing ergonomics are familiar.
 *
 * The `raw` field preserves the full provider payload for any field not covered
 * by the normalized properties.
 */
export interface OAuthUser {
    /** Stable, provider-scoped identifier for the user (e.g. GitHub numeric id). */
    id: string;
    nickname?: string;
    name?: string;
    /** May be `null` for providers/users that hide it (e.g. GitHub). */
    email?: string | null;
    avatar?: string;
    /** The full, unmodified user-info response from the provider. */
    raw: Record<string, unknown>;
}

/**
 * Token set returned by a successful authorization-code exchange.
 */
export interface TokenSet {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenType?: string;
    scope?: string;
    /** OIDC providers (Google, Microsoft) also return an id_token JWT. */
    idToken?: string;
}

/**
 * Per-provider credentials. The `redirectUrl` may be relative; it is resolved
 * to an absolute URL against the incoming request origin at redirect time.
 *
 * The optional `provider` bag carries provider-specific options — typed via
 * the generic `TProviderOpts`. Use it to pass Google's `hostedDomain`, GitLab's
 * `baseUrl`, Microsoft's `tenant`, etc. (see the per-provider option types
 * below).
 */
export interface OAuthProviderConfig<TProviderOpts = Record<string, unknown>> {
    clientId: string;
    clientSecret: string;
    redirectUrl: string;
    /** Override the provider's default scopes. */
    scopes?: string[];
    /** Provider-specific options. The shape depends on the provider. */
    provider?: TProviderOpts;
}

// --- Per-provider options (kept here to avoid circular imports between the
// provider factories and the shared config types). ---

/** Google OIDC options. */
export interface GoogleProviderOptions {
    /**
     * Hosted-domain hint (`hd`). Restricts sign-in to a specific Google
     * Workspace domain; passed as the `hd` authorize param.
     */
    hostedDomain?: string;
    /**
     * Request a refresh token. Sets `access_type=offline` and `prompt=consent`.
     */
    offlineAccess?: boolean;
    /**
     * Custom OpenID Connect issuer URL. Defaults to Google's public issuer.
     */
    issuer?: string;
}

/** GitLab options. */
export interface GitLabProviderOptions {
    /**
     * Base URL of the GitLab instance. Defaults to `https://gitlab.com`.
     * Override for self-hosted GitLab.
     */
    baseUrl?: string;
}

/** Microsoft (Azure AD v2.0) options. */
export interface MicrosoftProviderOptions {
    /**
     * Azure AD tenant: `'common'` (default), `'organizations'`,
     * `'consumers'`, or a tenant GUID / verified domain name.
     */
    tenant?: string;
}

/**
 * Definition of an OAuth 2.0 provider. First-party providers (GitHub, Google,
 * GitLab, Facebook, Microsoft) ship with the package; custom providers can be
 * declared with {@link defineOAuthProvider}.
 */
export interface OAuthProviderDefinition {
    /** Unique id used to look up the driver (e.g. `'github'`). */
    id: string;
    authorizeUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    /** Default scopes requested on redirect. */
    scopes: string[];
    /** Separator used when joining scopes in the authorize URL. Default: `' '` (space). */
    scopeSeparator?: string;
    /**
     * Normalize the raw user-info response into an {@link OAuthUser}.
     * Access to the {@link TokenSet} is provided so OIDC providers can decode
     * claims from the id_token.
     */
    normalizeUser: (raw: Record<string, unknown>, tokens: TokenSet) => OAuthUser | Promise<OAuthUser>;
    /**
     * Optional extra/optional query params to add to the authorize URL
     * (e.g. Google's `hd` hosted-domain hint, Apple's `response_mode`).
     * Reserved keys (`state`, `response_type`, `code_challenge*`) are dropped.
     *
     * Accepts any {@link OAuthProviderConfig} variant so it works with the
     * per-provider option bags (e.g. `OAuthProviderConfig<GoogleProviderOptions>`).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authorizeParams?: (config: OAuthProviderConfig<any>) => Record<string, string>;
    /**
     * Optional token-request body mutator. Some providers need extra fields
     * (e.g. Microsoft tenant, Apple JWT client_secret). The base set
     * (`grant_type`, `code`, `redirect_uri`, `client_id`, `client_secret`,
     * `code_verifier`) is already supplied.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tokenParams?: (config: OAuthProviderConfig<any>) => Record<string, string>;
    /**
     * Optional customizer for the user-info request (e.g. Facebook needs
     * `?fields=...`). Return extra query params to append to userInfoUrl.
     */
    userInfoParams?: () => Record<string, string>;
}

/**
 * Callback invoked by an OAuth flow after a successful authentication.
 *
 * The developer is responsible for mapping the {@link OAuthUser} to a local
 * application user and creating a session.
 *
 * Return a `Response` to control the HTTP behavior (e.g. a redirect). Return
 * nothing/`undefined` to use the default success redirect.
 *
 * The mapping to an app-specific user happens inside this callback; OAuth
 * itself always yields an {@link OAuthUser}.
 */
export type OAuthUserCallback = (
    user: OAuthUser,
    tokens: TokenSet,
    c: Context,
) => Promise<Response | void> | Response | void;

export type OAuthErrorCallback = (
    err: unknown,
    c: Context,
) => Promise<Response | void> | Response | void;

export interface OAuthCookieOptions {
    name?: string;
    /** Max age in seconds. Default: 600 (10 minutes). */
    maxAge?: number;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    path?: string;
}

export interface CreateOAuthConfig {
    /**
     * HMAC-SHA256 signing secret for the state/PKCE cookie. Provide a string
     * or a request-scoped resolver for runtimes such as Cloudflare Workers,
     * where bindings are available only through `c.env`. The resolved value
     * must contain at least 16 characters and should have 32 bytes of entropy.
     */
    secret: string | ((c: Context) => string | Promise<string>);
    /**
     * Per-provider credentials. First-party keys (`github`, `google`,
     * `gitlab`, `facebook`, `microsoft`) are typed with their specific option
     * bags; any other key is accepted for custom providers registered via
     * `customProviders`.
     */
    providers: {
        github?: OAuthProviderConfig<Record<string, never>>;
        google?: OAuthProviderConfig<GoogleProviderOptions>;
        gitlab?: OAuthProviderConfig<GitLabProviderOptions>;
        facebook?: OAuthProviderConfig<Record<string, never>>;
        microsoft?: OAuthProviderConfig<MicrosoftProviderOptions>;
        // Arbitrary custom provider ids (registered via `customProviders`).
        // `any` is required here so the precisely-typed first-party keys above
        // remain assignable to the index signature.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: OAuthProviderConfig<any> | undefined;
    };
    /** Custom provider definitions keyed by id (use {@link defineOAuthProvider}). */
    customProviders?: Record<string, OAuthProviderDefinition>;
    cookie?: OAuthCookieOptions;
    /**
     * Disable the state cookie entirely. The developer then becomes responsible
     * for CSRF protection of the callback (e.g. via a signed `state` query param
     * they verify themselves). Not recommended.
     */
    stateless?: boolean;
}
