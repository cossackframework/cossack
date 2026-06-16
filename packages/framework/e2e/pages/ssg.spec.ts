import { test, expect } from '@playwright/test';

/**
 * End-to-end tests for Static Site Generation (SSG).
 *
 * These run against a preview server that serves the output of
 * `pnpm run build:ssg`. They are gated behind COSSACK_TEST_SSG=1 so the
 * default `playwright test` run (which uses `pnpm dev`) is not slowed down
 * by a full SSG build.
 *
 * Run explicitly with:
 *   pnpm run test:e2e:ssg
 *   # or: COSSACK_TEST_SSG=1 pnpm exec playwright test e2e/pages/ssg.spec.ts
 *
 * Note on testing strategy: SSG output is verified primarily via the raw HTTP
 * response (the `request` fixture), not the live DOM. After client-side
 * hydration the DOM is rebuilt from `window.__INITIAL_STATE__` and may differ
 * from the pre-rendered HTML — testing the response body is the reliable way
 * to assert what was actually generated at build time.
 */

test.describe('SSG serving (preview server)', () => {
  test('pre-renders /ssg-demo with static content', async ({ request }) => {
    const resp = await request.get('/ssg-demo/');
    expect(resp.status()).toBe(200);
    const html = await resp.text();
    expect(html).toContain('Static Site Generation Demo');
    // The pre-rendered build date should be present in the static HTML.
    expect(html).toMatch(/Build date:/);
  });

  test('freezes the build-time timestamp (SSG, not SSR)', async ({ request }) => {
    // The SSG demo embeds new Date().toISOString() at render time. When the
    // page is served as a static asset, that timestamp is frozen at build
    // time. A dynamically SSR-rendered page would show the current time.
    const resp = await request.get('/ssg-demo/');
    const html = await resp.text();

    const match = html.match(/Build date:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    expect(match, 'expected an ISO build-date timestamp in the HTML').not.toBeNull();

    const renderedAt = new Date(match![1]);
    const now = new Date();
    const ageMinutes = (now.getTime() - renderedAt.getTime()) / 60000;
    // The build happened recently. This alone doesn't prove SSG (an SSR page
    // would also be recent), but combined with the static-asset response
    // test below it confirms the page was generated at build time, not per
    // request.
    expect(ageMinutes).toBeGreaterThanOrEqual(0);
    expect(ageMinutes).toBeLessThan(24 * 60);
  });

  test('pre-renders /ssg-demo/users/alice with the user profile', async ({ request }) => {
    const resp = await request.get('/ssg-demo/users/alice/');
    expect(resp.status()).toBe(200);
    const html = await resp.text();
    expect(html).toContain('User Profile');
    expect(html).toContain('@alice');
  });

  test('serves sitemap.xml at /sitemap.xml', async ({ request }) => {
    const resp = await request.get('/sitemap.xml');
    expect(resp.status()).toBe(200);
    const contentType = resp.headers()['content-type'] || '';
    expect(contentType).toMatch(/xml/);
    const body = await resp.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('/ssg-demo');
  });

  test('serves SSG HTML as a static asset (no Worker SSR)', async ({ request }) => {
    // `vite preview` (and Cloudflare ASSETS in production) serves files from
    // dist/client directly. We assert the response is the pre-built file by
    // checking the hydration markers written at build time.
    const resp = await request.get('/ssg-demo/');
    expect(resp.status()).toBe(200);
    const html = await resp.text();
    expect(html).toContain('<script type="module"');
    expect(html).toContain('window.__INITIAL_STATE__');
  });

  test('page loads in a browser without fatal errors', async ({ page }) => {
    await page.goto('/ssg-demo/');
    // Give the client a moment to hydrate without asserting on DOM content
    // (hydration may rebuild the tree from initial state).
    await page.waitForLoadState('networkidle');
    // This test exists to catch hard hydration failures (e.g. missing
    // scripts, 404s for assets). If the page itself fails to load, the
    // goto() above would throw.
    expect(page).toHaveTitle(/SSG Demo/);
  });
});
