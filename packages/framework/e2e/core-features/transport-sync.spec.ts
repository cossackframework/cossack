import { test, expect } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';
import { randomUUID } from 'node:crypto';

/**
 * Helper: read the current counter value from the page.
 * Waits for "Count: N" to be visible, then parses the value.
 */
async function getCounterValue(page: import('@playwright/test').Page): Promise<number> {
  // Clicks issued before hydration are lost, so every read also implies "ready".
  await waitForHydration(page);
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
  }, { timeout: 60000 }).toBeGreaterThanOrEqual(expected);
}

async function openSseChat(page: import('@playwright/test').Page, room: string): Promise<void> {
  const sseResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.startsWith('/sse/');
  });

  await page.goto(`/sse-chat?room=${encodeURIComponent(room)}`);
  const response = await sseResponse;
  expect(response.status()).toBe(200);
  await waitForHydration(page);
  await expect(page.locator('.sse-chat h1')).toHaveText('SSE Chat');
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
      const room = `transport-sync-${randomUUID()}`;
      await openSseChat(page, room);

      // The room is unique to this test, but shared by the two intended tabs.
      const tab2 = await context.newPage();
      await openSseChat(tab2, room);

      // Tab 1: send a message
      const input = page.getByPlaceholder('Type a message...', { exact: true });
      await expect(input).toBeEnabled();
      await input.fill('Hello from tab 1');
      await expect(input).toHaveValue('Hello from tab 1');
      await input.press('Enter');

      // Tab 1: user message should appear immediately
      await expect(page.locator('.msg.user .bubble').last()).toContainText('Hello from tab 1', { timeout: 5000 });

      // Tab 2: should see the user message broadcast via SSE
      await expect(tab2.locator('.msg.user .bubble').last()).toContainText('Hello from tab 1', { timeout: 10000 });

      await tab2.close();
    });

    test('should isolate state between different scope keys', async ({ page, context }) => {
      const alphaRoom = `transport-sync-alpha-${randomUUID()}`;
      const betaRoom = `transport-sync-beta-${randomUUID()}`;
      // A sender and a passive observer per room. Observers only receive
      // messages through their own SSE stream, so a message that reaches an
      // observer acts as an ordering barrier: anything broadcast earlier to the
      // wrong room would already have arrived on that stream.
      await openSseChat(page, alphaRoom);
      const alphaObserver = await context.newPage();
      await openSseChat(alphaObserver, alphaRoom);
      const tab2 = await context.newPage();
      await openSseChat(tab2, betaRoom);
      const betaObserver = await context.newPage();
      await openSseChat(betaObserver, betaRoom);

      const send = async (sender: import('@playwright/test').Page, text: string) => {
        const input = sender.getByPlaceholder('Type a message...', { exact: true });
        await expect(input).toBeEnabled({ timeout: 10_000 });
        await input.fill(text);
        await expect(input).toHaveValue(text);
        await input.press('Enter');
      };
      const userBubbles = (p: import('@playwright/test').Page) => p.locator('.msg.user .bubble');

      await send(page, 'alpha-msg');
      await expect(userBubbles(alphaObserver)).toHaveText(['alpha-msg'], { timeout: 10_000 });

      await send(tab2, 'beta-msg');
      // Barrier: beta-msg was broadcast after alpha-msg, so a leak would show first.
      await expect(userBubbles(betaObserver)).toHaveText(['beta-msg'], { timeout: 10_000 });
      await expect(betaObserver.locator('.messages')).not.toContainText('alpha-msg');
      await expect(userBubbles(tab2)).toHaveText(['beta-msg']);

      await send(page, 'alpha-msg-2');
      // Barrier: alpha-msg-2 was broadcast after beta-msg.
      await expect(userBubbles(alphaObserver)).toHaveText(['alpha-msg', 'alpha-msg-2'], { timeout: 10_000 });
      await expect(alphaObserver.locator('.messages')).not.toContainText('beta-msg');
      await expect(page.locator('.messages')).not.toContainText('beta-msg');

      await Promise.all([alphaObserver.close(), tab2.close(), betaObserver.close()]);
    });
  });
});
