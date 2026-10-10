import { test, expect, type Locator } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

/** The <strong> value next to a "Label:" paragraph inside a demo card. */
function stat(card: Locator, label: string): Locator {
  return card.locator('p', { hasText: label }).locator('strong');
}

test.describe('@Debounce / @Throttle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/debounce');
    await waitForHydration(page);
  });

  test('debounce coalesces rapid input into a single trailing call', async ({ page }) => {
    const card = page.locator('.cs-card').filter({ hasText: '@Debounce(500) search' }).filter({ hasNotText: '@Server()' });
    const input = card.getByPlaceholder('Type to search...');

    // Type 5 characters quickly (well within the 500ms window).
    await input.pressSequentially('hello', { delay: 30 });

    // The final query only lands via the trailing call; any non-debounced
    // intermediate call would have happened before it, so by now the count is final.
    await expect(stat(card, 'Last query:')).toHaveText('hello');
    await expect(stat(card, 'API calls:')).toHaveText('1');
    await expect(stat(card, 'Keystrokes:')).toHaveText('5');
  });

  test('debounces a @Server RPC: one request per pause', async ({ page }) => {
    const card = page.locator('.cs-card').filter({ hasText: '@Server() @Debounce(500) search' });
    const input = card.getByPlaceholder('Type to query the server...');
    const rpcs: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.postData()?.includes('searchServer')) rpcs.push(request.postData()!);
    });

    // Type "ap" quickly — well within the 500ms window.
    await input.pressSequentially('ap', { delay: 30 });

    // The trailing RPC fires once the debounce window elapses; then the server
    // runs and syncs @State back.
    await expect(stat(card, 'Server API calls:')).toHaveText('1', { timeout: 10_000 });
    await expect(stat(card, 'Keystrokes:')).toHaveText('2');
    // ...the server only saw the final query and computed results for it.
    await expect(stat(card, 'Last server query:')).toHaveText('ap');
    await expect(card.getByRole('listitem')).toHaveText(['apple', 'apricot', 'grape']);
    expect(rpcs).toHaveLength(1);
  });

  test('throttle runs at most once per window under rapid clicks', async ({ page }) => {
    const card = page.locator('.cs-card').filter({ hasText: '@Throttle(1000) click' });
    const button = card.getByRole('button', { name: 'Smash me' });
    const clicks = card.locator('strong');
    await expect(clicks).toHaveText('0');

    // Spam the button in one browser task so all clicks land inside a single
    // 1s window regardless of how slow the test runner is.
    await button.evaluate(element => { for (let i = 0; i < 6; i++) (element as HTMLElement).click(); });

    // Leading-edge throttle: exactly one should have registered.
    await expect(clicks).toHaveText('1');

    // Keep clicking until the window elapses: the next click registers again,
    // and clicks inside the window keep being dropped.
    const started = Date.now();
    await expect.poll(async () => {
      await button.click();
      return Number(await clicks.textContent());
    }, { intervals: [100], timeout: 5_000 }).toBe(2);
    expect(Date.now() - started).toBeGreaterThan(500);
  });
});
