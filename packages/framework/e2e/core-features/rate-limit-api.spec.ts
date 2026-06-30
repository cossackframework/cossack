import { test, expect } from '../fixtures';

test.describe('@RateLimit', () => {
  test('functional API route wrapper blocks after max with 429 + Retry-After', async ({ page }) => {
    // Load any page so the browser origin is the dev server.
    await page.goto('/debounce');
    await page.waitForLoadState('networkidle');

    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 4; i++) {
      last = await page.request.get('/api/rate-limited');
      statuses.push(last.status());
    }

    // 3 allowed (max), the 4th is rejected.
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(last!.headers()['retry-after']).toBeTruthy();
  });

  test('@Server @RateLimit rejects excess /crpc calls server-side', async ({ page }) => {
    await page.goto('/debounce');
    await page.waitForLoadState('networkidle');

    const componentRouteId = await page.evaluate(
      () => (window as any).__INITIAL_STATE__.componentRouteId,
    );

    const call = () =>
      page.evaluate(async (routeId: string) => {
        const res = await fetch('/crpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ componentRouteId: routeId, action: 'guardedSave', payload: [] }),
        });
        return { status: res.status, retryAfter: res.headers.get('Retry-After') };
      }, componentRouteId);

    // max: 3 per 10s — the first three run on the server, the fourth is 429'd
    // at the dispatch boundary (before the method body executes).
    const r1 = await call();
    const r2 = await call();
    const r3 = await call();
    const r4 = await call();

    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
    expect(r4.status).toBe(429);
    expect(r4.retryAfter).toBeTruthy();
  });
});
