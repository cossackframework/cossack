import type { MiddlewareHandler } from 'hono';
import type {
    CreateOAuthConfig,
    OAuthErrorCallback,
    OAuthUserCallback,
    OAuthProviderDefinition,
    OAuthUser,
} from './types';
import { createOAuthHandlers } from './handler';
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
 * const oauth = createOAuth({ secret: env.SECRET, providers: { github: {...} } });
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
 * is respected for the configurable ones.
 *
 * The user's config object is enriched in place with a non-enumerable
 * `__definition` so the kit can look up definitions per provider id.
 */
function buildDefinitions(
    config: CreateOAuthConfig,
): Record<string, OAuthProviderDefinition> {
    const defs: Record<string, OAuthProviderDefinition> = {
        github: githubProvider,
        facebook: facebookProvider,
    };

    // Google/GitLab/Microsoft accept per-config options. We honor the option
    // object attached to the first configured credential entry (best-effort —
    // these factories produce a definition with default URLs that are correct
    // for the public cloud; instance customization for GitLab is handled at
    // request time via resolveGitLabUrls).
    if (config.providers.google) {
        const providerOpts = (
            config.providers.google as CreateOAuthConfig['providers'][string] & {
                provider?: import('./providers/google').GoogleProviderOptions;
            }
        ).provider;
        defs.google = createGoogleProvider(providerOpts ?? {});
    }
    if (config.providers.gitlab) {
        const providerOpts = (
            config.providers.gitlab as CreateOAuthConfig['providers'][string] & {
                provider?: import('./providers/gitlab').GitLabProviderOptions;
            }
        ).provider;
        defs.gitlab = createGitLabProvider(providerOpts ?? {});
    }
    if (config.providers.microsoft) {
        const providerOpts = (
            config.providers.microsoft as CreateOAuthConfig['providers'][string] & {
                provider?: import('./providers/microsoft').MicrosoftProviderOptions;
            }
        ).provider;
        defs.microsoft = createMicrosoftProvider(providerOpts ?? {});
    }

    if (config.customProviders) {
        for (const [id, def] of Object.entries(config.customProviders)) {
            if (defs[id]) {
                throw new Error(
                    `OAuth custom provider "${id}" shadows a first-party provider. Use a unique id.`,
                );
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
    if (!config.secret || config.secret.length < 16) {
        throw new Error(
            'createOAuth: `secret` must be a string of at least 16 characters (use a 32+ byte random value from env).',
        );
    }

    const definitions = buildDefinitions(config);
    const cookieOptions = {
        name: config.cookie?.name,
        maxAge: config.cookie?.maxAge,
        secure: config.cookie?.secure,
        sameSite: config.cookie?.sameSite,
        path: config.cookie?.path,
    };

    const factory = (providerId: string) =>
        createOAuthHandlers(providerId, {
            config,
            definitions,
            cookieOptions,
            requestIsSecure: (c) => {
                const url = new URL(c.req.raw.url);
                if (url.protocol === 'https:') return true;
                return c.req.raw.headers.get('x-forwarded-proto') === 'https';
            },
        });

    return {
        redirect: (providerId) => factory(providerId).redirect(),
        callback: (providerId, opts) => factory(providerId).callback(opts),
    };
}

export { defineOAuthProvider } from './provider';
export type {
    CreateOAuthConfig,
    OAuthCookieOptions,
    OAuthErrorCallback,
    OAuthProviderConfig,
    OAuthProviderDefinition,
    OAuthUser,
    OAuthUserCallback,
    TokenSet,
} from './types';
export type {
    GoogleProviderOptions,
    GitLabProviderOptions,
    MicrosoftProviderOptions,
} from './providers';
