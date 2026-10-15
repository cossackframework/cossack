import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page, Server, State, type Middleware } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';
import { __resetSseStore, __sseStoreState, sseScopeName, syncSseState } from '../src/transports/sse';

// An SSE subscription runs every layout and page guard once, before the stream
// opens, with the route params it carries, checked as client input, exactly as
// SSR of that URL runs them. Forged params never reach a guard. An open stream
// runs the guards again, with the same params, each time it revalidates. Both
// backends (the Node store and the Cloudflare coordinator) follow this rule.
const { registry, guardLog, denied } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} as Record<string, any> },
  guardLog: [] as string[],
  denied: new Set<string>(),
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
  c.set('user', { id: 'u1' });
  c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: { reference: 'u1' } }));
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

/** A layout or page guard: records that it ran and the route param it saw. */
const guard = (name: string): Middleware => async (c, next) => {
  guardLog.push(`${name}:${c.req.param('team') ?? '-'}`);
  await next();
};
/** A page policy that decides on the route param: teams in `denied` are not allowed in. */
const denyTeams: Middleware = async (c, next) => {
  if (denied.has(c.req.param('team') ?? '')) return c.json({ error: 'Forbidden', code: 'COSSACK_AUTH_FORBIDDEN' }, 403);
  await next();
};

@Page({ middlewares: [guard('root')] })
class RootLayout extends Cossack { render() { return html`${this.children}`; } }

@Page({ middlewares: [guard('layout')] })
class TeamLayout extends Cossack { render() { return html`${this.children}`; } }

@Page({ transport: 'sse', scope: c => `team:${c.req.param('team')}`, middlewares: [guard('page'), denyTeams] })
class TeamPage extends Cossack {
  @State() count = 0;
  render() { return html`<main>${this.count}</main>`; }
  @Server() async increment() { return ++this.count; }
}

const pagePath = '/src/pages/teams/[team]/index.ts';
const layoutPath = '/src/pages/teams/[team]/layout.ts';
const rootPath = '/src/pages/layout.ts';
registry.pages[pagePath] = { default: TeamPage };
registry.layouts[rootPath] = { default: RootLayout };
registry.layouts[layoutPath] = { default: TeamLayout };

const { createApp } = await import('../src/router');
const pageId = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts)).routePathToIdMap.get(pagePath)!;
const guardsFor = (team: string) => [`root:${team}`, `layout:${team}`, `page:${team}`];

type Snapshot = { state: string; cursor: number };

/** Coordinator scope stand-in: first initialization wins, an event log, and held long-polls. */
class FakeSseScope {
  snapshot: Snapshot | null = null;
  events: Array<{ cursor: number; event: string; data: string }> = [];
  waiters = new Map<string, () => void>();

  async initialize(state: string) {
    const fresh = !this.snapshot;
    this.snapshot ??= { state, cursor: 0 };
    return { ...this.snapshot, fresh };
  }
  async currentState() { return this.snapshot && { ...this.snapshot }; }
  async updates(after: number, waitMs = 0, waiterId: string = crypto.randomUUID()) {
    const read = () => ({ snapshot: { ...this.snapshot! }, resync: false, events: this.events.filter(event => event.cursor > after) });
    if (waitMs && !read().events.length) {
      await new Promise<void>(resolve => {
        const wake = () => { clearTimeout(timer); this.waiters.delete(waiterId); resolve(); };
        const timer = setTimeout(wake, Math.min(waitMs, 1000));
        this.waiters.set(waiterId, wake);
      });
    }
    return read();
  }
  async cancelWait(waiterId: string) { this.waiters.get(waiterId)?.(); }
  async publish(state: string) { return this.append('state-update', state, true); }
  async broadcast(event: string, data: string) { return this.append(event, data, false); }
  async execute(action: (state: string) => Promise<Response>) { return action(this.snapshot!.state); }
  async cancel() {}
  async claimFlash() { return true; }
  private append(event: string, data: string, replacesState: boolean) {
    const cursor = this.events.length + 1;
    this.events.push({ cursor, event, data });
    this.snapshot = { state: replacesState ? data : this.snapshot!.state, cursor };
    for (const wake of [...this.waiters.values()]) wake();
    return { ...this.snapshot };
  }
}

interface Backend {
  bindings: Record<string, unknown>;
  /** The scope's state, or undefined when nothing created the scope. */
  state(team: string): unknown;
  /** Publish a new scope state without an RPC call (and its guards). */
  publish(team: string, state: Record<string, unknown>): Promise<void>;
}

const storeKey = (team: string) => `${pageId}:team:${team}`;
const backends: Array<[string, () => Backend]> = [
  ['Node store', () => ({
    bindings: { APP_URL: 'http://localhost' },
    state: team => __sseStoreState(storeKey(team)),
    publish: async (team, state) => { expect(syncSseState(storeKey(team), state)).toBeTypeOf('number'); },
  })],
  ['Cloudflare coordinator', () => {
    const scopes = new Map<string, FakeSseScope>();
    const scope = (team: string) => scopes.get(sseScopeName(pageId, `team:${team}`));
    return {
      bindings: { APP_URL: 'http://localhost', COSSACK_SSE: { getByName(name: string) {
        let found = scopes.get(name);
        if (!found) scopes.set(name, found = new FakeSseScope());
        return found;
      } } },
      state: team => scope(team)?.snapshot ?? undefined,
      publish: async (team, state) => { await scope(team)!.publish(JSON.stringify(state)); },
    };
  }],
];

const MISSING = Symbol('missing params');
const open: Array<{ controller: AbortController; response: Response }> = [];

afterEach(async () => {
  for (const { controller, response } of open.splice(0)) {
    controller.abort();
    await response.body?.cancel().catch(() => {});
  }
  __resetSseStore();
  guardLog.length = 0;
  denied.clear();
});

/** Read the stream until `text` arrives, with a deadline. */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, text: string, timeout = 3000): Promise<string> {
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeout;
  let received = '';
  while (!received.includes(text)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for ${text}; received ${JSON.stringify(received)}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = await Promise.race([
      reader.read(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), remaining); }),
    ]).finally(() => clearTimeout(timer));
    if (next === null) continue;
    if (next.done) throw new Error(`Stream ended before ${text}; received ${JSON.stringify(received)}`);
    received += decoder.decode(next.value, { stream: true });
  }
  return received;
}

describe.each(backends)('SSE subscription route params (%s)', (_backend, makeBackend) => {
  let backend: Backend;
  const app = () => createApp();

  const ssr = async (team: string) => {
    guardLog.length = 0;
    const response = await app().request(`/teams/${team}`, { headers: { accept: 'text/html' } }, backend.bindings);
    await response.text();
    return { status: response.status, guards: guardLog.splice(0) };
  };

  /** Open `/sse/:id` as the browser on `/teams/:team` does. Guards logged before the stream opens are returned. */
  const subscribe = async (team: string, params: unknown = { team }) => {
    guardLog.length = 0;
    const query = new URLSearchParams({ scopeKey: `team:${team}` });
    if (params !== MISSING) query.set('params', typeof params === 'string' ? params : JSON.stringify(params));
    const controller = new AbortController();
    const response = await app().request(`/sse/${pageId}?${query}`, { signal: controller.signal }, backend.bindings);
    open.push({ controller, response });
    return { response, guards: guardLog.splice(0) };
  };

  const rpc = async (team: string, pageParams: unknown = { team }) => {
    guardLog.length = 0;
    const response = await app().request('/crpc', {
      method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentRouteId: pageId, action: 'increment', payload: [], state: { count: 0 }, scopeKey: `team:${team}`, pageParams }),
    }, backend.bindings);
    return { status: response.status, body: await response.json() as any, guards: guardLog.splice(0) };
  };

  it('runs every layout and page guard once, before the stream opens, with the params SSR uses', async () => {
    backend = makeBackend();
    const page = await ssr('alpha');
    expect(page).toEqual({ status: 200, guards: guardsFor('alpha') });
    const { response, guards } = await subscribe('alpha');
    expect(response.status, response.status === 200 ? '' : await response.clone().text()).toBe(200);
    expect(guards).toEqual(page.guards);
    // The first delivery revalidates the stream once, with the same params.
    const initial = await readUntil(response.body!.getReader(), 'event: connected');
    expect(initial).toContain('data: {"count":0}');
    expect(guardLog.splice(0)).toEqual(page.guards);
  });

  it('lets a page policy deny the subscription for a param it denies on SSR, and allow another', async () => {
    backend = makeBackend();
    denied.add('beta');
    expect((await ssr('beta')).status).toBe(403);
    const forbidden = await subscribe('beta');
    expect(forbidden.response.status).toBe(403);
    expect(await forbidden.response.json()).toMatchObject({ code: 'COSSACK_AUTH_FORBIDDEN' });
    expect(forbidden.guards).toEqual(guardsFor('beta'));
    // The stream never opened: no cold start, no scope.
    expect(backend.state('beta')).toBeUndefined();

    const allowed = await subscribe('alpha');
    expect(allowed.response.status).toBe(200);
    expect(allowed.guards).toEqual(guardsFor('alpha'));
    expect(await readUntil(allowed.response.body!.getReader(), 'event: connected')).toContain('data: {"count":0}');
  });

  it.each([
    ['missing params', MISSING],
    ['no params', {}],
    ['an extra param', { team: 'alpha', role: 'admin' }],
    ['an empty param', { team: '' }],
    ['a non-string param', { team: 1 }],
    ['a dot segment', { team: '..' }],
    ['a single-dot segment', { team: '.' }],
    ['an array', ['alpha']],
    ['a JSON string', '"alpha"'],
    ['malformed JSON', '{team'],
  ])('rejects %s with 400 before any guard runs', async (_case, params) => {
    backend = makeBackend();
    const { response, guards } = await subscribe('alpha', params);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_REQUEST_INVALID' });
    expect(guards).toEqual([]);
    expect(backend.state('alpha')).toBeUndefined();
  });

  it('revalidates an open stream with the same params, so the policy still applies', async () => {
    backend = makeBackend();
    const { response } = await subscribe('alpha');
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await readUntil(reader, 'event: connected');
    guardLog.length = 0;
    denied.add('alpha');
    await backend.publish('alpha', { count: 5 });
    const terminal = await readUntil(reader, 'event: authorization-error');
    expect(terminal).toContain('COSSACK_REALTIME_AUTH_CHANGED');
    expect(terminal).not.toContain('"count":5');
    expect(guardLog).toEqual(guardsFor('alpha'));
    expect((await reader.read()).done).toBe(true);
  });

  it('keeps SSE /crpc actions on the page params they carry', async () => {
    backend = makeBackend();
    denied.add('beta');
    const { response } = await subscribe('alpha');
    const reader = response.body!.getReader();
    await readUntil(reader, 'event: connected');
    expect(await rpc('alpha')).toMatchObject({ status: 200, body: { _cossack_return: 1 }, guards: guardsFor('alpha') });
    // The subscriber receives the action's state after a revalidation with its own params.
    expect(await readUntil(reader, '"count":1')).toContain('event: state-update');
    expect(guardLog.splice(0)).toEqual(guardsFor('alpha'));
    expect(await rpc('beta')).toMatchObject({ status: 403, guards: guardsFor('beta') });
    expect(await rpc('alpha', { team: 'alpha', role: 'admin' }))
      .toMatchObject({ status: 400, body: { code: 'COSSACK_RPC_REQUEST_INVALID' }, guards: [] });
  });
});
