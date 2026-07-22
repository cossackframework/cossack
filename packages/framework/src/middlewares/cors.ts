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
}

export const defaultCorsConfig: CorsConfig = {
  enabled: true,
  origins: [],
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  headers: [],
  exposeHeaders: [],
  credentials: false,
  maxAge: 86400,
};

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

/** Built-in CORS for convention-based API routes (`/api` and `/api/*`). */
export function createCorsMiddleware(
  getConfig: () => Partial<CorsConfig> | undefined = () => config<Partial<CorsConfig>>('cors'),
): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path !== '/api' && !c.req.path.startsWith('/api/')) return next();

    const settings = resolvedConfig(getConfig());
    if (!settings.enabled) return next();
    if (settings.credentials && settings.origins.some((origin) => origin.trim() === '*')) {
      throw new Error('[Cossack] Invalid CORS configuration: credentials cannot be enabled with the global "*" origin. Configure explicit origins instead.');
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
