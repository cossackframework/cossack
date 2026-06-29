import type { Context, MiddlewareHandler } from 'hono';
import type {
    CreateOAuthConfig,
    OAuthErrorCallback,
    OAuthUserCallback,
    OAuthProviderConfig,
    OAuthProviderDefinition,
    OAuthUser,
} from './types';
import {
    constantTimeEqual,
    consumeStateCookie,
    generateState,
    setStateCookie,
    type StateCookieOptions,
} from './state';
import { createPkcePair } from './pkce';
import { buildAuthorizeUrl, exchangeCode, fetchUserInfo, resolveRedirectUrl } from './flow';

interface HandlerDeps {
    config: CreateOAuthConfig;
    definitions: Record<string, OAuthProviderDefinition>;
    cookieOptions: StateCookieOptions;
    requestIsSecure: (c: Context) => boolean;
}

function defaultRequestIsSecure(c: Context): boolean {
    const url = new URL(c.req.raw.url);
    if (url.protocol === 'https:') return true;
    // Cloudflare and many proxies set this.
    const cf = c.req.raw.headers.get('x-forwarded-proto');
    return cf === 'https';
}

function defaultSuccessRedirect(c: Context): Response {
    return c.redirect('/');
}

function defaultErrorHandler(err: unknown, c: Context): Response {
    const message = err instanceof Error ? err.message : 'OAuth authentication failed';
    return c.json({ error: message }, 502);
}

/**
 * Build the redirect + callback Hono handlers for a given provider.
 *
 * Both are returned as {@link MiddlewareHandler}s so they can be passed
 * directly to `app.get(path, handler)` or `@Page({ middlewares })`-style use.
 */
export function createOAuthHandlers(
    providerId: string,
    deps: HandlerDeps,
): {
    redirect: () => MiddlewareHandler;
    callback: (opts: {
        onUser: OAuthUserCallback;
        onError?: OAuthErrorCallback;
        successRedirect?: string;
    }) => MiddlewareHandler;
} {
    const definition = deps.definitions[providerId];
    const config = deps.config.providers[providerId];

    if (!definition) {
        throw new Error(
            `Unknown OAuth provider "${providerId}". Register it via createOAuth({ customProviders: {...} }).`,
        );
    }
    if (!config) {
        throw new Error(
            `No credentials configured for OAuth provider "${providerId}". Add it to createOAuth({ providers: {...} }).`,
        );
    }

    const redirect = (): MiddlewareHandler => {
        return async (c: Context, next): Promise<Response | void> => {
            try {
                const state = generateState();
                const pkce = await createPkcePair();
                const redirectUrl = resolveRedirectUrl(config.redirectUrl, c);

                const authorizeUrl = buildAuthorizeUrl({
                    definition,
                    config,
                    redirectUrl,
                    state,
                    codeChallenge: pkce.codeChallenge,
                });

                if (!deps.config.stateless) {
                    await setStateCookie(
                        c,
                        { state, codeVerifier: pkce.codeVerifier },
                        deps.config.secret,
                        deps.cookieOptions,
                        deps.requestIsSecure(c),
                    );
                }

                return c.redirect(authorizeUrl);
            } catch (err) {
                return defaultErrorHandler(err, c);
            }
        };
    };

    const callback =
        (opts: {
            onUser: OAuthUserCallback;
            onError?: OAuthErrorCallback;
            successRedirect?: string;
        }): MiddlewareHandler =>
        async (c: Context, next): Promise<Response | void> => {
            const onError = opts.onError ?? defaultErrorHandler;
            try {
                const url = new URL(c.req.raw.url);
                const error = url.searchParams.get('error');
                if (error) {
                    const desc = url.searchParams.get('error_description');
                    throw new Error(
                        `OAuth provider returned error: ${error}${desc ? ` (${desc})` : ''}`,
                    );
                }

                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');
                if (!code || !state) {
                    throw new Error('OAuth callback missing required `code` or `state` parameter.');
                }

                let storedVerifier: string | undefined;
                if (!deps.config.stateless) {
                    const stored = await consumeStateCookie(c, deps.config.secret, deps.cookieOptions);
                    if (!stored) {
                        throw new Error('OAuth state cookie missing, expired, or tampered.');
                    }
                    if (!constantTimeEqual(stored.state, state)) {
                        throw new Error('OAuth state mismatch (possible CSRF attack).');
                    }
                    storedVerifier = stored.codeVerifier;
                } else {
                    // Stateless mode: verifier cannot be recovered without a cookie;
                    // caller must provide their own PKCE/state handling.
                    storedVerifier = '';
                }

                const redirectUrl = resolveRedirectUrl(config.redirectUrl, c);
                const tokens = await exchangeCode({
                    definition,
                    config,
                    redirectUrl,
                    code,
                    codeVerifier: storedVerifier,
                });

                const { user } = await fetchUserInfo({ definition, tokens });

                const result = await opts.onUser(user, tokens, c);
                if (result instanceof Response) {
                    return result;
                }
                return opts.successRedirect
                    ? c.redirect(opts.successRedirect)
                    : defaultSuccessRedirect(c);
            } catch (err) {
                const result = await onError(err, c);
                if (result instanceof Response) return result;
                return defaultErrorHandler(err, c);
            }
        };

    return { redirect, callback };
}
