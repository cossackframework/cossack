import type { MiddlewareHandler } from 'hono';
import type {
    CreateOAuthConfig,
    OAuthErrorCallback,
    OAuthUserCallback,
    OAuthProviderDefinition,
    OAuthUser,
} from './types';
import { createOAuthHandlers } from './handler';
import { OAuthError, safeOAuthError } from './errors';
import {
    facebookProvider,
    createGoogleProvider,
    createGitLabProvider,
    createMicrosoftProvider,
    githubProvider,
} from './providers';

/**
 * Kit returned by {@link createOAuth}. Provides per-provider redirect + callback
 * handlers that can be mounted directly as Hono routes.
 *
 * @example
 * ```ts
 * const oauth = createOAuth({ secret: env.SECRET, stateStore, providers: { github: {...} } });
 * app.get('/auth/github/redirect', oauth.redirect('github'));
 * app.get('/auth/github/callback', oauth.callback('github', {
 *   async onUser(user, tokens, c) { /* ...create session... *\/; return c.redirect('/'); },
 * }));
 * ```
 */
export interface OAuthKit {
    /**
     * Returns a Hono handler that redirects to the provider's authorize URL,
     * setting a signed state+PKCE cookie first.
     */
    redirect: (provider: string) => MiddlewareHandler;
    /**
     * Returns a Hono handler that processes the OAuth callback, verifies state,
     * exchanges the code, fetches the user, and invokes `onUser`.
     */
    callback: (
        provider: string,
        opts: {
            onUser: OAuthUserCallback;
            onError?: OAuthErrorCallback;
            /** Override the default `/` success redirect. */
            successRedirect?: string;
        },
    ) => MiddlewareHandler;
}

/**
 * Build the internal provider-definition registry from a user config.
 * First-party providers are pre-registered with their defaults; the user's
 * per-provider `provider` option (e.g. `{ provider: { hostedDomain: '...' } }`)
 * is honored for the configurable ones (Google/GitLab/Microsoft).
 */
function buildDefinitions(
    config: CreateOAuthConfig,
): Record<string, OAuthProviderDefinition> {
    const defs: Record<string, OAuthProviderDefinition> = {
        github: githubProvider,
        facebook: facebookProvider,
    };

    if (config.providers.google) {
        defs.google = createGoogleProvider(config.providers.google.provider ?? {});
    }
    if (config.providers.gitlab) {
        defs.gitlab = createGitLabProvider(config.providers.gitlab.provider ?? {});
    }
    if (config.providers.microsoft) {
        defs.microsoft = createMicrosoftProvider(config.providers.microsoft.provider ?? {});
    }

    if (config.customProviders) {
        for (const [id, def] of Object.entries(config.customProviders)) {
            if (defs[id]) {
                throw new OAuthError('COSSACK_OAUTH_CONFIGURATION_INVALID');
            }
            defs[id] = def;
        }
    }
    return defs;
}

/**
 * Create an OAuth kit with one or more providers.
 *
 * @param config.credentials - one entry per provider: `{ clientId, clientSecret, redirectUrl, scopes? }`.
 * @param config.secret      - HMAC signing secret for the state cookie (env-provided).
 * @param config.customProviders - additional {@link OAuthProviderDefinition}s keyed by id.
 */
export function createOAuth(config: CreateOAuthConfig): OAuthKit {
    try { return buildOAuthKit(config); }
    catch (error) { throw safeOAuthError(error, 'COSSACK_OAUTH_CONFIGURATION_INVALID'); }
}

function buildOAuthKit(config: CreateOAuthConfig): OAuthKit {
    if (!config || !config.providers || typeof config.providers !== 'object' || Array.isArray(config.providers)) {
        throw new OAuthError('COSSACK_OAUTH_CONFIGURATION_INVALID');
    }
    if (
        (typeof config.secret === 'string' && config.secret.length < 16) ||
        (typeof config.secret !== 'string' && typeof config.secret !== 'function')
    ) {
        throw new OAuthError('COSSACK_OAUTH_SECRET_INVALID');
    }

    if (config.stateless !== undefined && typeof config.stateless !== 'boolean') throw new OAuthError('COSSACK_OAUTH_CONFIGURATION_INVALID');
    if (config.stateless) {
        if (config.stateStore !== undefined) throw new OAuthError('COSSACK_OAUTH_STATE_STORE_INVALID');
    } else if (!config.stateStore || typeof config.stateStore.create !== 'function' || typeof config.stateStore.consume !== 'function') {
        throw new OAuthError('COSSACK_OAUTH_STATE_STORE_INVALID');
    }
    const maxAge = config.cookie?.maxAge ?? 600;
    if (!Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > 400 * 24 * 60 * 60) throw new OAuthError('COSSACK_OAUTH_CONFIGURATION_INVALID');
    const name = config.cookie?.name ?? 'cossack_oauth_state';
    const path = config.cookie?.path ?? '/';
    const sameSite = config.cookie?.sameSite ?? 'lax';
    const secure = config.cookie?.secure;
    if (typeof name !== 'string' || !/^[!#$%&'*+.^_\x60|~0-9a-zA-Z-]+$/.test(name) ||
        typeof path !== 'string' || !path.startsWith('/') || /[;\x00-\x20\x7f]/.test(path) ||
        typeof sameSite !== 'string' || !['lax', 'strict', 'none'].includes(sameSite.toLowerCase()) ||
        (secure !== undefined && typeof secure !== 'boolean') ||
        (sameSite.toLowerCase() === 'none' && secure === false) ||
        ((name.startsWith('__Host-') || name.startsWith('__Secure-')) && secure !== true) ||
        (name.startsWith('__Host-') && path !== '/')) throw new OAuthError('COSSACK_OAUTH_CONFIGURATION_INVALID');

    const definitions = buildDefinitions(config);
    const cookieOptions = {
        name: config.cookie?.name,
        maxAge: config.cookie?.maxAge,
        secure: config.cookie?.secure,
        sameSite: config.cookie?.sameSite,
        path: config.cookie?.path,
    };

    const factory = (providerId: string) => {
        try { return createOAuthHandlers(providerId, {
            config,
            definitions,
            cookieOptions,
            requestIsSecure: (c) => {
                const url = new URL(c.req.raw.url);
                if (url.protocol === 'https:') return true;
                return c.req.raw.headers.get('x-forwarded-proto') === 'https';
            },
        }); }
        catch (error) { throw safeOAuthError(error, 'COSSACK_OAUTH_CONFIGURATION_INVALID'); }
    };

    return {
        redirect: (providerId) => factory(providerId).redirect(),
        callback: (providerId, opts) => factory(providerId).callback(opts),
    };
}

export { defineOAuthProvider } from './provider';
export { OAuthError, type OAuthErrorCode, type OAuthErrorStage } from './errors';
export type {
    CreateOAuthConfig,
    OAuthCookieOptions,
    OAuthErrorCallback,
    OAuthProviderConfig,
    OAuthProviderDefinition,
    OAuthUser,
    OAuthUserCallback,
    OAuthStateRecord,
    OAuthStateStore,
    TokenSet,
} from './types';
export type {
    GoogleProviderOptions,
    GitLabProviderOptions,
    MicrosoftProviderOptions,
} from './providers';
