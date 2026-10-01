import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { __resetRequestContextForTests } from '@cossackframework/core';
import { createRequestContextMiddleware } from '../src/middlewares/request-context';
import {
  createSessionMiddleware,
  session,
  type SessionStore,
} from '../src/session';

class MemorySessionStore implements SessionStore {
  readonly rows = new Map<string, {
    data: Record<string, unknown>;
    userId?: string;
    expiresAt: number;
  }>();
  private sequence = 0;

  async create(ttlMs = 60_000): Promise<string> {
    const id = `session-${++this.sequence}`;
    this.rows.set(id, { data: {}, expiresAt: Date.now() + ttlMs });
    return id;
  }

  async has(id: string) {
    return (this.rows.get(id)?.expiresAt ?? 0) > Date.now();
  }

  async load(id: string) {
    const row = this.rows.get(id);
    return !row || row.expiresAt <= Date.now() ? {} : { ...row.data };
  }

  async get<T>(id: string, key: string): Promise<T | undefined> {
    return (await this.load(id))[key] as T | undefined;
  }

  getAll(id: string) {
    return this.load(id);
  }

  async set(id: string, key: string, value: unknown, ttlMs = 60_000) {
    const row = this.rows.get(id) ?? {
      data: {},
      expiresAt: Date.now() + ttlMs,
    };
    row.data[key] = value;
    row.expiresAt = Date.now() + ttlMs;
    this.rows.set(id, row);
  }

  async unset(id: string, key: string) {
    const row = this.rows.get(id);
    if (row) delete row.data[key];
  }

  async destroy(id: string) {
    this.rows.delete(id);
  }

  async bindUser(id: string, userId: string) {
    const row = this.rows.get(id);
    if (row) row.userId = userId;
  }

  async purgeExpired() {
    let count = 0;
    for (const [id, row] of this.rows) {
      if (row.expiresAt <= Date.now()) {
        this.rows.delete(id);
        count++;
      }
    }
    return count;
  }
}

function cookieValue(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(';')[0]
    .slice(name.length + 1);
}

describe('generic session middleware', () => {
  afterAll(() => __resetRequestContextForTests());

  it('preserves anonymous bags, auth bridging, bindUser, and destruction', async () => {
    const store = new MemorySessionStore();
    const app = new Hono();
    app.use('*', createRequestContextMiddleware());
    app.use('*', createSessionMiddleware({
      store,
      ttl: 60_000,
      authCookieReader: (context) => context.req.header('x-auth-session'),
    }));
    app.post('/bag', async (context) => {
      await session().set('cart', { items: [1, 2] });
      return context.json({ id: session().id() });
    });
    app.get('/bag', async (context) => {
      return context.json({
        id: session().id(),
        cart: await session().get('cart'),
      });
    });
    app.post('/bind', async (context) => {
      await session().bindUser('user-1');
      return context.text('ok');
    });
    app.delete('/session', async (context) => {
      await session().destroy();
      return context.text('ok');
    });

    const first = await app.request('/bag', { method: 'POST' });
    const id = cookieValue(first, 'cossack_sid');
    expect(id).toBe('session-1');
    expect(await (await app.request('/bag', {
      headers: { cookie: `cossack_sid=${id}` },
    })).json()).toEqual({ id, cart: { items: [1, 2] } });

    const authId = await store.create();
    await store.set(authId, 'cart', 'auth-cart');
    const bridged = await app.request('/bag', {
      headers: { 'x-auth-session': authId },
    });
    expect(await bridged.json()).toEqual({ id: authId, cart: 'auth-cart' });
    expect(cookieValue(bridged, 'cossack_sid')).toBeUndefined();

    const bound = await app.request('/bind', {
      method: 'POST',
      headers: { cookie: `cossack_sid=${id}` },
    });
    const rotatedId = cookieValue(bound, 'cossack_sid');
    expect(rotatedId).not.toBe(id);
    expect(store.rows.has(id!)).toBe(false);
    expect(store.rows.get(rotatedId!)?.userId).toBe('user-1');
    expect(store.rows.get(rotatedId!)?.data.cart).toEqual({ items: [1, 2] });
    const deleted = await app.request('/session', {
      method: 'DELETE',
      headers: { cookie: `cossack_sid=${rotatedId}` },
    });
    expect(store.rows.has(rotatedId!)).toBe(false);
    expect(cookieValue(deleted, 'cossack_sid')).toBe('');
  });

  it('replaces unknown and expired cookie IDs before writes', async () => {
    const store = new MemorySessionStore();
    const expired = await store.create(-1000);
    const app = new Hono();
    app.use('*', createRequestContextMiddleware());
    app.use('*', createSessionMiddleware({ store }));
    app.post('/', async (c) => { await session().set('key', 'value'); return c.text(session().id()); });
    for (const id of ['attacker-chosen', expired]) {
      const response = await app.request('/', { method: 'POST', headers: { cookie: `cossack_sid=${id}` } });
      expect(response.status).toBe(200);
      expect(await response.text()).not.toBe(id);
      expect(cookieValue(response, 'cossack_sid')).toBeTruthy();
    }
    expect(store.rows.has('attacker-chosen')).toBe(false);
    expect(store.rows.get(expired)?.data).toEqual({});
  });

  it('throws a clear error without a configured store or request session', async () => {
    expect(() => session()).toThrow(/No session in scope/);
    const app = new Hono();
    app.use('*', createRequestContextMiddleware());
    app.use('*', createSessionMiddleware());
    app.get('/', (context) => context.text('unreachable'));
    const response = await app.request('/');
    expect(response.status).toBe(500);
  });
});
