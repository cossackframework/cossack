import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { config } from '../config.js';

export interface CorsConfig {
  enabled: boolean;
  origins: string[];
  methods: string[];
  headers: string[];
  exposeHeaders: string[];
  credentials: boolean;
  maxAge: number;
  /**
   * Paths outside `/api` the built-in CORS also covers, such as `/webhooks` or
   * `/feed.xml`: an entry covers that exact path and everything below it.
   * `/api` and `/api/*` are always covered. Pages and framework transports are
   * not meant to be listed; an entry without a leading slash never matches.
   */
  paths?: string[];
}

export const defaultCorsConfig: CorsConfig = {
  enabled: true,
  origins: [],
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  headers: [],
  exposeHeaders: [],
  credentials: false,
  maxAge: 86400,
  paths: [],
};

/** Whether the built-in CORS applies to a request path: `/api`, or a configured path and its descendants. */
export function isCorsPath(path: string, extra: readonly string[] = []): boolean {
  if (path === '/api' || path.startsWith('/api/')) return true;
  return extra.some((entry) => {
    const prefix = entry.trim().replace(/\/+$/, '');
    return prefix.startsWith('/') && (path === prefix || path.startsWith(`${prefix}/`));
  });
}

type OriginMatcher = (origin: string) => boolean;

function wildcardMatcher(value: string): OriginMatcher | undefined {
  const match = /^(https?:\/\/)?\*\.([^/?#:*]+(?:\.[^/?#:*]+)*)$/.exec(value);
  if (!match) return undefined;
  const scheme = match[1]?.slice(0, -3);
  const domain = match[2].toLowerCase();
  return (origin) => {
    try {
      const url = new URL(origin);
      return (url.protocol === 'http:' || url.protocol === 'https:') &&
        (!scheme || url.protocol === `${scheme}:`) &&
        url.hostname.toLowerCase().endsWith(`.${domain}`);
    } catch {
      return false;
    }
  };
}

function exactMatcher(value: string): OriginMatcher | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      return undefined;
    }
    const expected = url.origin;
    return (origin) => {
      try {
        const candidate = new URL(origin);
        return candidate.origin === expected && candidate.pathname === '/' && !candidate.search && !candidate.hash;
      } catch {
        return false;
      }
    };
  } catch {
    return undefined;
  }
}

export function createOriginResolver(origins: string[]): (origin: string) => string | null {
  if (origins.some((origin) => origin.trim() === '*')) return () => '*';
  const matchers = origins
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((origin) => wildcardMatcher(origin) ?? exactMatcher(origin))
    .filter((matcher): matcher is OriginMatcher => Boolean(matcher));
  return (origin) => matchers.some((matcher) => matcher(origin)) ? origin : null;
}

function resolvedConfig(value: Partial<CorsConfig> | undefined): CorsConfig {
  return { ...defaultCorsConfig, ...value };
}

/** Built-in CORS for convention-based API routes (`/api` and `/api/*`) and configured `paths`. */
export function createCorsMiddleware(
  getConfig: () => Partial<CorsConfig> | undefined = () =>
    // Optional middleware config need not exist in the application's typed registry.
    (config as (key: string) => unknown)('cors') as Partial<CorsConfig> | undefined,
): MiddlewareHandler {
  return async (c, next) => {
    const settings = resolvedConfig(getConfig());
    if (!isCorsPath(c.req.path, settings.paths)) return next();
    if (!settings.enabled) return next();
    if (settings.credentials && settings.origins.some((origin) => origin.trim() === '*')) {
      throw new Error('[Cossack] Invalid CORS configuration: credentials cannot be enabled with the global "*" origin. Configure explicit origins instead.');
    }

    // Hono's CORS middleware terminates every OPTIONS request with 204. Only
    // an OPTIONS request carrying both required preflight headers is actually
    // a CORS preflight; ordinary OPTIONS requests must reach the application's
    // middleware and explicit route handler.
    if (
      c.req.method === 'OPTIONS' &&
      (!c.req.header('origin') || !c.req.header('access-control-request-method'))
    ) {
      return next();
    }

    return cors({
      origin: createOriginResolver(settings.origins),
      allowMethods: settings.methods.map((method) => method.toUpperCase()),
      allowHeaders: settings.headers,
      exposeHeaders: settings.exposeHeaders,
      credentials: settings.credentials,
      maxAge: settings.maxAge,
    })(c, next);
  };
}
