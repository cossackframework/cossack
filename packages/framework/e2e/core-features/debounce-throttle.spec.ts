import { test, expect } from '../fixtures';

test.describe('@Debounce / @Throttle', () => {
  test('debounce coalesces rapid input into a single trailing call', async ({ page }) => {
    await page.goto('/debounce');
    await page.waitForLoadState('networkidle');

    const input = page.locator('input[placeholder="Type to search..."]');

    // Type 5 characters quickly (well within the 500ms window).
    await input.pressSequentially('hello', { delay: 30 });

    // Wait long enough for the trailing-edge timer (500ms) to fire.
    await page.waitForTimeout(700);

    const body = await page.locator('body').textContent() || '';

    // All 5 keystrokes were recorded...
    const keystrokes = body.match(/Keystrokes:\s*(\d+)/);
    expect(keystrokes && parseInt(keystrokes[1], 10)).toBe(5);

    // ...but only a single API call fired, carrying the final query.
    const apiCalls = body.match(/API calls:\s*(\d+)/);
    expect(apiCalls && parseInt(apiCalls[1], 10)).toBe(1);

    const lastQuery = body.match(/Last query:\s*(.+?)(?=\s|$)/);
    expect(lastQuery && lastQuery[1]).toBe('hello');
  });

  test('debounces a @Server RPC: one request per pause', async ({ page }) => {
    await page.goto('/debounce');
    await page.waitForLoadState('networkidle');

    // Scope to the server-side card so the shared "Keystrokes:" label is unambiguous.
    const card = page.locator('.cs-card').filter({ hasText: '@Server() @Debounce(500) search' });
    const input = card.locator('input[placeholder="Type to query the server..."]');
    const cardText = async () => (await card.textContent()) || '';

    // Type "ap" quickly — well within the 500ms window.
    await input.pressSequentially('ap', { delay: 30 });

    const readServerCalls = async () => {
      const m = (await cardText()).match(/Server API calls:\s*(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };

    // The trailing RPC fires once the debounce window elapses; then the server
    // runs and syncs @State back. Poll for that single server call to land.
    await expect.poll(readServerCalls, { timeout: 10000 }).toBe(1);

    const text = await cardText();

    // Both keystrokes were counted client-side...
    const keystrokes = text.match(/Keystrokes:\s*(\d+)/);
    expect(keystrokes && parseInt(keystrokes[1], 10)).toBe(2);

    // ...but the server only saw the final query.
    const lastQuery = text.match(/Last server query:\s*(\S+)/);
    expect(lastQuery && lastQuery[1]).toBe('ap');

    // And the server actually computed results for that query.
    expect(text).toContain('apple');
    expect(text).toContain('apricot');
  });

  test('throttle runs at most once per window under rapid clicks', async ({ page }) => {
    await page.goto('/debounce');
    await page.waitForLoadState('networkidle');

    const button = page.locator('button:has-text("Smash me")');

    const readClicks = async () => {
      const text = await page.locator('body').textContent() || '';
      const m = text.match(/Registered clicks \(max 1\/sec\):\s*(\d+)/);
      return m ? parseInt(m[1], 10) : -1;
    };

    const before = await readClicks();

    // Spam the button rapidly — all within a single 1s window.
    for (let i = 0; i < 6; i++) {
      await button.click({ delay: 20 });
    }

    // Leading-edge throttle: exactly one should have registered.
    const afterSpam = await readClicks();
    expect(afterSpam - before).toBe(1);

    // After the window elapses, the next click registers again.
    await page.waitForTimeout(1100);
    await button.click();
    const afterWait = await readClicks();
    expect(afterWait - before).toBe(2);
  });
});
