import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { Cossack, Page } from '@cossackframework/core';
import { createApp } from '../src/router';
import { createApiHandler } from '../src/api-handler';

/**
 * Unit tests for class-based API routes.
 *
 * Verifies the two fixes for class components that omit `render()` (i.e. pure
 * API routes, like `src/pages/api/class-based.ts`):
 *   - GET returns JSON (routed through the API handler), not HTML
 *   - POST/PUT/DELETE continue to return JSON
 *
 * And a regression check that a normal page (with `render()`) still returns
 * HTML on GET.
 *
 * Uses Hono's built-in app.request() to dispatch mock requests through the full
 * middleware/handler stack without starting an HTTP server. The
 * `src/pages/api/class-based.ts` page is auto-discovered via the
 * `virtual:cossack-pages` module (registered by the cossackPages vite plugin in
 * the framework's vitest config).
 */
describe('class-based API routes', () => {
  const app = createApp();

  it('GET returns JSON (not HTML) for a class without render()', async () => {
    const res = await app.request('/api/class-based');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({ message: 'Hello from class!' });
  });

  it('POST returns JSON with the echoed body and 201 status', async () => {
    const res = await app.request('/api/class-based', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });

    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({ message: 'Post received!', echo: { key: 'value' } });
  });

  it('PUT returns 200 when the validation query param is present', async () => {
    const res = await app.request('/api/class-based?validation=ok', {
      method: 'PUT',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: 'Validation passed!' });
  });

  it('PUT returns 400 when the validation query param is missing', async () => {
    const res = await app.request('/api/class-based', {
      method: 'PUT',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: 'Validation query parameter is required' });
  });

  it('DELETE returns JSON', async () => {
    const res = await app.request('/api/class-based', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({ message: 'Delete request received!' });
  });

  it('regression: a page with render() still returns HTML on GET', async () => {
    // The index page (`src/pages/index/index.ts`) overrides render().
    const res = await app.request('/');

    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('<script type="module"');
  });
});

/**
 * Direct unit tests for createApiHandler's method-resolution logic, isolated
 * from the global page registry. Verifies the get()/init() alias: when a class
 * defines only init() (not get()), GET must invoke init() rather than the
 * base-class get() no-op. Regression for an earlier bug where `in` was used
 * instead of hasOwnProperty, causing the inherited base get() to always match.
 */
describe('createApiHandler method resolution', () => {
  it('falls back to init() when get() is not overridden', async () => {
    @Page({ transport: 'http' })
    class InitOnlyApi extends Cossack {
      // No get() override — only init().
      async init() {
        return this.c.json({ handler: 'init' });
      }
    }

    const app = new Hono();
    app.get('/init-only', createApiHandler(InitOnlyApi, ['get', 'init']));

    const res = await app.request('/init-only');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handler: 'init' });
  });

  it('prefers get() over init() when both are overridden', async () => {
    @Page({ transport: 'http' })
    class BothApi extends Cossack {
      async get() {
        return this.c.json({ handler: 'get' });
      }
      async init() {
        return this.c.json({ handler: 'init' });
      }
    }

    const app = new Hono();
    app.get('/both', createApiHandler(BothApi, ['get', 'init']));

    const res = await app.request('/both');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handler: 'get' });
  });

  it('returns 405 when neither get() nor init() is overridden', async () => {
    @Page({ transport: 'http' })
    class NeitherApi extends Cossack {
      // Neither get() nor init() — only post().
      async post() {
        return this.c.json({ ok: true });
      }
    }

    const app = new Hono();
    app.get('/neither', createApiHandler(NeitherApi, ['get', 'init']));

    const res = await app.request('/neither');
    expect(res.status).toBe(405);
  });
});
