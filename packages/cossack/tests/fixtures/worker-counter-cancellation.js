import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, vi } from 'vitest';

// Test-only provider: deliberately ignores cancellation and replies only after
// another real HTTP request releases it. The production router owns the race.
export async function writeCounterCancellation(root) {
  await fs.writeFile(path.join(root, 'src/rpc-counter-store.ts'), `
    import { InMemoryRateLimitStore, setRateLimitStore, type RateLimitHitOptions } from '@cossackframework/core';
    const memory = new InMemoryRateLimitStore();
    const gates = new Map<string, { hits: number; aborted?: boolean; release?: () => void }>();
    setRateLimitStore({ async hit(key: string, window: number, options?: RateLimitHitOptions) {
      const gate = gates.get(JSON.parse(key)[1]);
      if (!gate) return memory.hit(key, window, options);
      gate.hits++; gate.aborted = options?.signal?.aborted ?? false;
      options?.signal?.addEventListener('abort', () => { gate.aborted = true; }, { once: true });
      await new Promise<void>(resolve => { gate.release = resolve; });
      return { count: 1, resetAt: Date.now() + window };
    } });
    export const counterFixture = {
      arm(key: string) { gates.set(key, { hits: 0 }); },
      release(key: string) { gates.get(key)?.release?.(); },
      stats(key: string) { const gate = gates.get(key); return { hits: gate?.hits ?? 0, aborted: gate?.aborted ?? false }; },
    };
  `);
  const middleware = path.join(root, 'src/bootstrap/middlewares.ts');
  const bootstrap = await fs.readFile(middleware, 'utf8');
  await fs.writeFile(middleware, "import '../rpc-counter-store';\n" + bootstrap.replace("const middlewares: MiddlewareHandler[] = [", `const middlewares: MiddlewareHandler[] = [
      async (c, next) => {
        if (c.req.header('X-Counter-Abort') === 'explicit') {
          const controller = new AbortController();
          c.req.raw = new Request(c.req.raw, { signal: controller.signal });
          const timer = setTimeout(() => controller.abort(), 500);
          try { await next(); } finally { clearTimeout(timer); }
        } else await next();
      },`));
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/api/rpc-check-counter.ts'), `
    import { counterFixture } from '../../rpc-counter-store';
    export const POST = async c => {
      const { key, command } = await c.req.json();
      counterFixture[command](key); return c.json({ ok: true });
    };
    export const GET = async c => {
      const route = c.req.query('route'); const scope = c.req.query('scope');
      const queue = route && scope ? await c.env.COSSACK_SSE.getByName(JSON.stringify([route, scope])).queueStatus() : null;
      return c.json({ ...counterFixture.stats(c.req.query('key')), queue });
    };
  `);
}

export async function checkCounterCancellation(server, serverUrl, cookie, readHydration) {
  const headers = { origin: serverUrl.origin, cookie, 'Content-Type': 'application/json' };
  const command = async (key, command) => expect((await server.fetch('/api/rpc-check-counter', {
    method: 'POST', headers, body: JSON.stringify({ key, command }),
  })).status).toBe(200);
  const audit = async key => (await server.fetch('/api/rpc-check?key=' + key, { headers })).json();
  for (const transport of ['http', 'sse']) {
    const page = await server.fetch('/rpc-check/' + transport, { headers });
    const state = readHydration(await page.text());
    const owner = state._layout_stack.at(-1).componentRouteId;
    const stats = async key => (await server.fetch('/api/rpc-check-counter?' + new URLSearchParams({
      key, route: state.componentRouteId, scope: state.scopeKey,
    }), { headers })).json();
    const invoke = (key, { signal, service = false, upload = false, deadline = false } = {}) => {
      const envelope = { componentRouteId: state.componentRouteId, scopeKey: state.scopeKey,
        state: { count: 0 }, action: deadline ? 'counterDeadline' : 'counterGuarded', payload: [key],
        ...(service ? { service: { ownerRouteId: owner, slot: '0' } } : {}) };
      if (!upload) return fetch(new URL('/crpc', serverUrl), { method: 'POST', signal,
        headers: { ...headers, 'X-Counter-Case': key, ...(signal ? { 'X-Counter-Abort': 'explicit' } : {}) }, body: JSON.stringify(envelope) });
      const form = new FormData();
      for (const [name, value] of Object.entries(envelope)) form.set(name,
        typeof value === 'string' ? value : JSON.stringify(value));
      return fetch(new URL('/upload', serverUrl), { method: 'POST', signal,
        headers: { origin: headers.origin, cookie, 'X-Counter-Case': key, ...(signal ? { 'X-Counter-Abort': 'explicit' } : {}) }, body: form });
    };
    // Real TCP requests to the built Worker, for page/service JSON and multipart
    // actions. A server middleware explicitly aborts its request signal. Native
    // workerd does not report the pre-header TCP disconnect on this baseline;
    // this test proves the router bridge, not incoming disconnect delivery.
    for (const service of [false, true]) for (const upload of [false, true]) {
      const key = `counter-${transport}-${service}-${upload}`;
      await command(key, 'arm');
      const abandoned = new AbortController();
      const pending = invoke(key, { signal: abandoned.signal, service, upload }).catch(() => null);
      await vi.waitFor(async () => expect((await stats(key)).hits).toBe(1), { timeout: 3000 });
      const cancelled = await pending; expect(cancelled).not.toBe(null);
      expect(await cancelled.json(), key).toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
      abandoned.abort();
      await vi.waitFor(async () => {
        const status = await stats(key); expect(status.aborted, key).toBe(true);
        if (transport === 'sse') expect(status.queue.pending).toBe(0);
      }, { timeout: 3000 });
      const next = await invoke(key + '-next', { service, upload });
      expect(next.status).toBe(200); expect(next.headers.get('X-Counter-Context')).toBe('set'); await next.text();
      expect(await audit(key)).toEqual([]);
      await command(key, 'release');
      expect(await audit(key)).toEqual([]);
    }
    for (const service of [false, true]) {
      const key = `counter-deadline-${transport}-${service}`;
      await command(key, 'arm');
      const response = await invoke(key, { service, deadline: true });
      expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId: response.headers.get('X-Cossack-Request-Id') });
      expect((await stats(key)).aborted).toBe(true); expect(await audit(key)).toEqual([]);
      const next = await invoke(key + '-next', { service });
      expect(next.status).toBe(200); expect(next.headers.get('X-Counter-Context')).toBe('set'); await next.text();
      await command(key, 'release'); expect(await audit(key)).toEqual([]);
    }
    if (transport !== 'sse') continue;
    const activeKey = 'counter-queued-active'; const queuedKey = 'counter-queued-aborted';
    await command(activeKey, 'arm'); await command(queuedKey, 'arm');
    const active = invoke(activeKey);
    await vi.waitFor(async () => expect((await stats(activeKey)).hits).toBe(1));
    const abandoned = new AbortController();
    const queued = invoke(queuedKey, { signal: abandoned.signal }).catch(() => null);
    await vi.waitFor(async () => expect((await stats(queuedKey)).queue.queued).toBe(1));
    const cancelled = await queued; expect(cancelled).not.toBe(null);
    expect(cancelled.status).toBe(499);
    expect(await cancelled.json()).toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
    abandoned.abort();
    await vi.waitFor(async () => expect((await stats(queuedKey)).queue.queued).toBe(0));
    expect((await stats(queuedKey)).hits).toBe(0);
    expect((await stats(activeKey)).aborted).toBe(false);
    const successorKey = 'counter-queued-successor'; const successor = invoke(successorKey);
    await vi.waitFor(async () => expect((await stats(successorKey)).queue.queued).toBe(1));
    expect(await audit(successorKey)).toEqual([]);
    await command(activeKey, 'release');
    expect((await active).status).toBe(200); await (await active).text();
    expect((await successor).status).toBe(200); await (await successor).text();
    expect((await stats(queuedKey)).hits).toBe(0); expect(await audit(queuedKey)).toEqual([]);
    await command(queuedKey, 'release');
    expect((await stats(successorKey)).queue.pending).toBe(0);
  }
}
