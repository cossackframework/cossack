import { test, expect } from '../fixtures';

// E2E test for the cache example page (/examples/cache).
//
// The page caches the current datetime, waits ~3 seconds server-side, then
// reads it back. A passing run proves the cache stored and served the value
// (the cached timestamp matches the write time, not the later read time).
//
// Run serially: the demo uses a shared in-memory cache (per-isolate) with a
// fixed key, so parallel test runs would interfere with each other's writes.
test.describe.serial('Cache Example Page', () => {
  /** Wait until the result table is rendered (the page wrote results into @State). */
  async function waitForResult(page: import('@playwright/test').Page): Promise<void> {
    await page.waitForFunction(
      () => {
        const text = document.body.textContent || '';
        // The result panel contains "Cache works" once the test completes.
        return text.includes('Cache works');
      },
      { timeout: 20_000 },
    );
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/cache');
    await page.waitForLoadState('networkidle');
  });

  test('should render the page with a run button', async ({ page }) => {
    const body = await page.locator('body').textContent();
    expect(body).toContain('Cache Example');
    await expect(page.locator('button:has-text("Run cache test")')).toBeVisible();
  });

  test('should cache a datetime and read it back (cache hit)', async ({ page }) => {
    await page.click('button:has-text("Run cache test")');

    // The server method waits ~3s. Wait for the result panel to appear.
    await waitForResult(page);

    // The "written to cache" and "read from cache" timestamps must be equal
    // (the value was served from the cache, not recomputed).
    const body = await page.locator('body').textContent();
    expect(body).toContain('Cache works');

    const writtenMatch = body?.match(/Written to cache at\s+([0-9T:.Z-]+)/);
    const cachedMatch = body?.match(/Read from cache at\s+([0-9T:.Z-]+)/);
    const readMatch = body?.match(/Actual current time at read\s+([0-9T:.Z-]+)/);

    expect(writtenMatch?.[1]).toBeTruthy();
    expect(cachedMatch?.[1]).toBeTruthy();
    expect(readMatch?.[1]).toBeTruthy();

    // Cached value === stored value (cache hit).
    expect(cachedMatch![1]).toBe(writtenMatch![1]);
    // ...and it is older than the actual current time at read (delay elapsed).
    expect(new Date(cachedMatch![1]).getTime()).toBeLessThan(new Date(readMatch![1]).getTime());
  });

  test('should show the artificial delay elapsed', async ({ page }) => {
    await page.click('button:has-text("Run cache test")');
    await waitForResult(page);

    const body = await page.locator('body').textContent();
    const delayMatch = body?.match(/Artificial delay\s+([0-9]+)ms/);
    const elapsed = delayMatch ? parseInt(delayMatch[1], 10) : 0;
    // The delay is ~3s; allow a tolerant lower bound for timer jitter.
    expect(elapsed).toBeGreaterThanOrEqual(2500);
  });

  test('should work consistently across consecutive runs', async ({ page }) => {
    // First run writes + reads the cache.
    await page.click('button:has-text("Run cache test")');
    await waitForResult(page);
    const body1 = await page.locator('body').textContent();
    expect(body1).toContain('Cache works');
    const cached1 = body1?.match(/Read from cache at\s+([0-9T:.Z-]+)/)?.[1];
    const written1 = body1?.match(/Written to cache at\s+([0-9T:.Z-]+)/)?.[1];
    expect(cached1).toBe(written1); // first run: cache hit

    // Second run writes a fresh value + reads it back. Should also hit.
    await page.click('button:has-text("Run cache test")');
    await waitForResult(page);
    const body2 = await page.locator('body').textContent();
    expect(body2).toContain('Cache works');
    const cached2 = body2?.match(/Read from cache at\s+([0-9T:.Z-]+)/)?.[1];
    const written2 = body2?.match(/Written to cache at\s+([0-9T:.Z-]+)/)?.[1];
    expect(cached2).toBe(written2); // second run: cache hit
  });
});
