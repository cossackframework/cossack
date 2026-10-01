import { getRequestContext } from '@cossackframework/core';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const DEFAULT_COOKIE_NAME = 'cossack_sid';
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_CONTEXT_KEY = 'session';
const SESSION_STORE_CONTEXT_KEY = 'sessionStore';

/**
 * ORM-agnostic persistent session contract. Applications can provide the ORM
 * store from `@cossackframework/database/cossack`, or any structurally compatible
 * implementation.
 */
export interface SessionStore {
  create(ttlMs?: number): Promise<string>;
  has(sessionId: string): Promise<boolean>;
  load(sessionId: string): Promise<Record<string, unknown>>;
  get<T = unknown>(sessionId: string, key: string): Promise<T | undefined>;
  getAll(sessionId: string): Promise<Record<string, unknown>>;
  set(sessionId: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
  unset(sessionId: string, key: string): Promise<void>;
  destroy(sessionId: string): Promise<void>;
  bindUser(sessionId: string, userId: string): Promise<void>;
  purgeExpired(): Promise<number>;
}

export interface SessionHandle {
  id(): string;
  get<T = unknown>(key: string): Promise<T | undefined>;
  getAll(): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
  unset(key: string): Promise<void>;
  bindUser(userId: string): Promise<void>;
  destroy(): Promise<void>;
}

export interface SessionMiddlewareOptions {
  /**
   * Store instance or per-request factory. If omitted, the middleware reads a
   * `sessionStore` value previously set on the Hono context.
   */
  store?: SessionStore | ((context: Context) => SessionStore | Promise<SessionStore>);
  /** Anonymous-session cookie name. Defaults to `cossack_sid`. */
  cookieName?: string;
  /** Sliding session TTL in milliseconds. Defaults to 30 days. */
  ttl?: number;
  /** Reuse an auth-managed session ID when one is available. */
  authCookieReader?: (
    context: Context,
  ) => string | undefined | Promise<string | undefined>;
  /** Whether anonymous cookies are HTTP-only. Defaults to true. */
  httpOnly?: boolean;
}

async function resolveStore(
  context: Context,
  source: SessionMiddlewareOptions['store'],
): Promise<SessionStore> {
  const store = typeof source === 'function'
    ? await source(context)
    : source ?? context.get(SESSION_STORE_CONTEXT_KEY);
  if (!store) {
    throw new Error(
      '[Cossack] Session middleware requires a store. Pass { store } or set ' +
      '`sessionStore` in an earlier middleware.',
    );
  }
  return store as SessionStore;
}

export function createSessionMiddleware(
  options: SessionMiddlewareOptions = {},
): MiddlewareHandler {
  const cookieName = options.cookieName ?? DEFAULT_COOKIE_NAME;
  const ttl = options.ttl ?? DEFAULT_TTL_MS;
  const httpOnly = options.httpOnly ?? true;

  return async (context, next) => {
    const store = await resolveStore(context, options.store);
    let sessionId: string | undefined;
    let authProvidedId = false;
    if (options.authCookieReader) {
      sessionId = await options.authCookieReader(context);
      authProvidedId = Boolean(sessionId);
    }
    if (!sessionId) sessionId = getCookie(context, cookieName);

    // Unknown/expired IDs must never become caller-chosen store keys.
    if (sessionId && !await store.has(sessionId)) {
      sessionId = undefined;
      authProvidedId = false;
    }
    let issuedAnonymousId = false;
    if (!sessionId) {
      sessionId = await store.create(ttl);
      issuedAnonymousId = true;
    }

    let destroyed = false;
    const currentId = () => {
      if (destroyed) throw new Error('[Cossack] Session has been destroyed.');
      return sessionId!;
    };
    const current: SessionHandle = {
      id: currentId,
      get: <T = unknown>(key: string) => store.get<T>(currentId(), key),
      getAll: () => store.getAll(currentId()),
      set: (key, value) => store.set(currentId(), key, value, ttl),
      unset: (key) => store.unset(currentId(), key),
      async bindUser(userId) {
        if (authProvidedId) throw new Error('[Cossack] Rotate auth-managed sessions through your auth provider.');
        const previous = currentId();
        const data = await store.getAll(previous);
        const replacement = await store.create(ttl);
        try {
          for (const [key, value] of Object.entries(data)) await store.set(replacement, key, value, ttl);
          await store.bindUser(replacement, userId);
          await store.destroy(previous);
        } catch (error) {
          await store.destroy(replacement);
          throw error;
        }
        sessionId = replacement;
        issuedAnonymousId = true;
      },
      async destroy() {
        await store.destroy(currentId());
        destroyed = true;
      },
    };
    context.set(SESSION_CONTEXT_KEY, current);
    await next();

    if (destroyed && !authProvidedId) deleteCookie(context, cookieName, { path: '/' });
    if (!destroyed && issuedAnonymousId && !authProvidedId) {
      setCookie(context, cookieName, sessionId, {
        httpOnly,
        secure: context.req.url.startsWith('https://'),
        sameSite: 'Lax',
        path: '/',
        maxAge: Math.floor(ttl / 1000),
      });
    }
  };
}

/** Return the session bound to the active framework request context. */
export function session(): SessionHandle {
  const context = getRequestContext();
  const current = context?.get(SESSION_CONTEXT_KEY) as SessionHandle | undefined;
  if (!current) {
    throw new Error(
      '[Cossack] No session in scope. Register createSessionMiddleware() before ' +
      'auth and application handlers.',
    );
  }
  return current;
}
