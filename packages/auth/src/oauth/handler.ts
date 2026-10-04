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
    clearStateCookie,
    generateState,
    setStateCookie,
    type StateCookieOptions,
} from './state';
import { createPkcePair } from './pkce';
import { buildAuthorizeUrl, exchangeCode, fetchUserInfo, resolveRedirectUrl } from './flow';
import { OAuthError, runOAuthStage, safeOAuthError } from './errors';

interface HandlerDeps {
    config: CreateOAuthConfig;
    definitions: Record<string, OAuthProviderDefinition>;
    cookieOptions: StateCookieOptions;
    requestIsSecure: (c: Context) => boolean;
}

async function resolveSecret(config: CreateOAuthConfig, c: Context): Promise<string> {
    // Static secrets are validated once by createOAuth(). Resolvers must be
    // checked per request because their value may vary with the context.
    return runOAuthStage('COSSACK_OAUTH_SECRET_INVALID', async () => {
        const secret = typeof config.secret === 'function' ? await config.secret(c) : config.secret;
        if (typeof secret !== 'string' || secret.length < 16) throw new OAuthError('COSSACK_OAUTH_SECRET_INVALID');
        return secret;
    });
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

function defaultErrorHandler(err: OAuthError, c: Context): Response {
    const { message, ...diagnostic } = err.toJSON();
    return c.json({ error: message, ...diagnostic }, err.status);
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
        throw new OAuthError('COSSACK_OAUTH_PROVIDER_UNKNOWN');
    }
    if (!config || !['clientId', 'clientSecret', 'redirectUrl'].every(key =>
        typeof config[key as keyof OAuthProviderConfig] === 'string' &&
        (config[key as keyof OAuthProviderConfig] as string).trim().length > 0)) {
        throw new OAuthError('COSSACK_OAUTH_CREDENTIALS_MISSING');
    }

    const redirect = (): MiddlewareHandler => {
        return async (c: Context, next): Promise<Response | void> => {
            try {
                const usePkce = !deps.config.stateless;
                const secret = usePkce ? await resolveSecret(deps.config, c) : undefined;
                return await runOAuthStage('COSSACK_OAUTH_REDIRECT_FAILED', async () => {
                    const state = generateState();
                    const redirectUrl = resolveRedirectUrl(config.redirectUrl, c);

                    // PKCE requires recovering the verifier across the round-trip,
                    // which needs the state cookie. In stateless mode there is no
                    // cookie store, so PKCE is skipped — the developer is then
                    // responsible for CSRF protection (see docs/oauth.md).
                    const pkce = usePkce ? await createPkcePair() : null;

                    const authorizeUrl = buildAuthorizeUrl({
                        definition,
                        config,
                        redirectUrl,
                        state,
                        codeChallenge: pkce?.codeChallenge,
                    });

                    if (usePkce) {
                        await setStateCookie(
                            c,
                            { state, codeVerifier: pkce!.codeVerifier },
                            secret!,
                            deps.cookieOptions,
                            deps.requestIsSecure(c),
                        );
                    }

                    return c.redirect(authorizeUrl);
                });
            } catch (err) {
                return defaultErrorHandler(safeOAuthError(err, 'COSSACK_OAUTH_REDIRECT_FAILED'), c);
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
            let stateCookieConsumed = false;
            try {
                const url = new URL(c.req.raw.url);
                const error = url.searchParams.get('error');
                if (error) {
                    throw new OAuthError(error === 'access_denied' ? 'COSSACK_OAUTH_CONSENT_DENIED' : 'COSSACK_OAUTH_PROVIDER_DENIED');
                }

                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');
                if (!code || !state) {
                    throw new OAuthError('COSSACK_OAUTH_CALLBACK_INVALID');
                }

                let storedVerifier: string | undefined;
                if (!deps.config.stateless) {
                    const secret = await resolveSecret(deps.config, c);
                    stateCookieConsumed = true;
                    const stored = await runOAuthStage('COSSACK_OAUTH_STATE_INVALID', () => consumeStateCookie(c, secret, deps.cookieOptions));
                    if (!stored) {
                        throw new OAuthError('COSSACK_OAUTH_STATE_INVALID');
                    }
                    if (!constantTimeEqual(stored.state, state)) {
                        throw new OAuthError('COSSACK_OAUTH_STATE_MISMATCH');
                    }
                    storedVerifier = stored.codeVerifier;
                }
                // In stateless mode there is no verifier to recover (PKCE was
                // not sent on the redirect). `exchangeCode` omits the
                // `code_verifier` field when `storedVerifier` is undefined.

                const redirectUrl = await runOAuthStage('COSSACK_OAUTH_CONFIGURATION_INVALID', () => resolveRedirectUrl(config.redirectUrl, c));
                const tokens = await exchangeCode({
                    definition,
                    config,
                    redirectUrl,
                    code,
                    codeVerifier: storedVerifier,
                });

                const { user } = await fetchUserInfo({ definition, tokens });

                const result = await runOAuthStage('COSSACK_OAUTH_ACCOUNT_MAPPING_FAILED', () => opts.onUser(user, tokens, c));
                if (result instanceof Response) {
                    return result;
                }
                return opts.successRedirect
                    ? c.redirect(opts.successRedirect)
                    : defaultSuccessRedirect(c);
            } catch (err) {
                if (!deps.config.stateless && !stateCookieConsumed) clearStateCookie(c, deps.cookieOptions);
                const diagnostic = safeOAuthError(err, 'COSSACK_OAUTH_CALLBACK_INVALID');
                try {
                    const result = await onError(diagnostic, c);
                    if (result instanceof Response) return result;
                    return defaultErrorHandler(diagnostic, c);
                } catch {
                    return defaultErrorHandler(new OAuthError('COSSACK_OAUTH_ERROR_HANDLER_FAILED'), c);
                }
            }
        };

    return { redirect, callback };
}
