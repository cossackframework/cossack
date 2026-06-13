import { test, expect } from '../fixtures';

/**
 * Helper: read the current counter value from the page.
 * Waits for "Count: N" to be visible, then parses the value.
 */
async function getCounterValue(page: import('@playwright/test').Page): Promise<number> {
  const countEl = page.locator('text=/Count:\\s*\\d+/').first();
  await expect(countEl).toBeVisible({ timeout: 10000 });
  const text = await countEl.textContent();
  const match = text?.match(/Count:\s*(\d+)/i);
  if (!match) throw new Error(`Could not parse counter value from: ${text}`);
  return parseInt(match[1], 10);
}

/**
 * Helper: poll until the counter value reaches at least `expected`.
 * Uses locator-based polling (re-reads DOM each tick) to avoid JS
 * evaluation races that waitForFunction can hit under heavy parallelism.
 */
async function waitForCounterAtLeast(page: import('@playwright/test').Page, expected: number): Promise<void> {
  // Use Playwright locator (pierces shadow DOM) instead of page.evaluate
  // which cannot read content inside web component shadow roots.
  // Generous timeout: the shared DO may be slow under heavy parallelism.
  await expect.poll(async () => {
    const text = await page.locator('body').textContent({ timeout: 5000 });
    const match = text?.match(/Count:\s*(\d+)/i);
    return match ? parseInt(match[1], 10) : -1;
  }, { timeout: 60000, interval: 500 }).toBeGreaterThanOrEqual(expected);
}

test.describe('Transport Multi-Tab Sync', () => {
  // These tests open multiple tabs and wait for transport-dependent state,
  // so they need extra time and run serially to avoid DO contention.
  test.describe.configure({ timeout: 120000, mode: 'serial' });

  test.describe('Durable Object (WebSocket)', () => {
    test('should sync counter state across two tabs', async ({ page, context }) => {
      // Tab 1: load the counter page and read the current count
      await page.goto('/stateless-counter');
      const beforeClick = await getCounterValue(page);

      // Tab 2: open the same page in a new tab
      const tab2 = await context.newPage();
      await tab2.goto('/stateless-counter');
      await getCounterValue(tab2);

      // Tab 1: click increment
      await page.click('button:has-text("Increment")');

      // Tab 1: assert count incremented by at least 1
      // (other parallel tests may also increment the shared DO)
      await waitForCounterAtLeast(page, beforeClick + 1);
      const tab1After = await getCounterValue(page);

      // Tab 2: should eventually see the same count (broadcast via WS)
      await waitForCounterAtLeast(tab2, tab1After);

      await tab2.close();
    });

    test('should handle concurrent increments from two tabs', async ({ page, context }) => {
      // Tab 1: load the counter page
      await page.goto('/stateless-counter');
      const beforeClicks = await getCounterValue(page);

      // Tab 2: open the same page
      const tab2 = await context.newPage();
      await tab2.goto('/stateless-counter');
      await getCounterValue(tab2);

      // Both tabs click increment concurrently
      await page.click('button:has-text("Increment")');
      await tab2.click('button:has-text("Increment")');

      // Both tabs should see count >= beforeClicks + 2 from our two clicks
      // (plus any increments from other parallel tests)
      await waitForCounterAtLeast(page, beforeClicks + 2);
      const tab1Final = await getCounterValue(page);

      // Tab 2 should converge to the same value as tab 1
      await waitForCounterAtLeast(tab2, tab1Final);
      const tab2Final = await getCounterValue(tab2);

      expect(tab2Final).toBe(tab1Final);

      await tab2.close();
    });
  });

  test.describe('SSE', () => {
    test('should sync state across two tabs', async ({ page, context }) => {
      // Tab 1: load the SSE chat page
      // Use waitForSelector instead of networkidle — SSE keeps a persistent
      // connection open, so networkidle never resolves.
      await page.goto('/sse-chat');
      await page.waitForSelector('.sse-chat h1');

      // Tab 2: open the same page (same default scope)
      const tab2 = await context.newPage();
      await tab2.goto('/sse-chat');
      await tab2.waitForSelector('.sse-chat h1');

      // Tab 1: send a message
      await page.fill('input[type="text"]', 'Hello from tab 1');
      await page.click('button[type="submit"]');

      // Tab 1: user message should appear immediately
      await expect(page.locator('.msg.user .bubble')).toContainText('Hello from tab 1', { timeout: 5000 });

      // Tab 2: should see the user message broadcast via SSE
      await expect(tab2.locator('.msg.user .bubble')).toContainText('Hello from tab 1', { timeout: 10000 });

      await tab2.close();
    });

    test('should isolate state between different scope keys', async ({ page, context }) => {
      // Tab 1: join room alpha
      await page.goto('/sse-chat?room=alpha');
      await page.waitForSelector('.sse-chat h1');

      // Tab 2: join room beta
      const tab2 = await context.newPage();
      await tab2.goto('/sse-chat?room=beta');
      await tab2.waitForSelector('.sse-chat h1');

      // Tab 1: send a message in room alpha
      await page.fill('input[type="text"]', 'alpha-msg');
      await page.click('button[type="submit"]');

      // Tab 1: should see the alpha message
      await expect(page.locator('.msg.user .bubble').first()).toContainText('alpha-msg', { timeout: 5000 });

      // Tab 2: should NOT see the alpha message (different scope)
      // Wait a reasonable time then verify it's absent
      await tab2.waitForTimeout(2000);
      const tab2Body = await tab2.locator('.messages').textContent();
      expect(tab2Body).not.toContain('alpha-msg');

      // Tab 2: send a message in room beta
      await tab2.fill('input[type="text"]', 'beta-msg');
      await tab2.click('button[type="submit"]');

      // Tab 2: should see the beta message
      await expect(tab2.locator('.msg.user .bubble').first()).toContainText('beta-msg', { timeout: 5000 });

      // Tab 1: should NOT see the beta message (different scope)
      await page.waitForTimeout(2000);
      const tab1Body = await page.locator('.messages').textContent();
      expect(tab1Body).not.toContain('beta-msg');

      await tab2.close();
    });
  });
});
