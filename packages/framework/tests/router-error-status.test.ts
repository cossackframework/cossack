import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/router';

/**
 * Unit tests for HTTP error status codes.
 *
 * Verifies that the router returns correct HTTP status codes for error
 * scenarios:
 *   - Non-existent routes → 404 (with custom 404 page rendered)
 *   - /error route (not a valid page) → 404
 *
 * Uses Hono's built-in app.request() to dispatch mock requests through the
 * full middleware/handler stack without starting an HTTP server.
 */
describe('router error status codes', () => {
  const app = createApp();

  it('returns HTTP 404 for a non-existent route', async () => {
    const res = await app.request('/this-page-does-not-exist-xyz');

    expect(res.status).toBe(404);
  });

  it('renders the custom 404 page (HTML, not plain text) for non-existent routes', async () => {
    const res = await app.request('/this-page-does-not-exist-xyz');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);

    const html = await res.text();
    // The custom 404 page renders "404" in an <h1>
    expect(html).toContain('404');
    // Should include the hydration script (rendered via renderRoot)
    expect(html).toContain('<script type="module"');
  });

  it('returns HTTP 404 for /error (not a routable page)', async () => {
    const res = await app.request('/error');

    expect(res.status).toBe(404);
  });

  it('falls back to nearest 404 page for nested non-existent routes', async () => {
    const res = await app.request('/some/deep/nested/non-existent/path');

    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('404');
  });

  it('returns a valid content-type header on 404 responses', async () => {
    const res = await app.request('/missing');

    expect(res.status).toBe(404);
    // The custom 404 page is served as HTML
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });
});
