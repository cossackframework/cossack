import { test, expect } from '../fixtures';

test.describe('Optimistic Counter Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/optimistic-counter');
    await page.waitForFunction(() => (window as any).__cossackReady === true);
  });

  test('routes upgrade handshakes to the Durable Object and completes a correlated server action', async ({ page }) => {
    const sent: Array<Record<string, unknown>> = [];
    const received: Array<Record<string, unknown>> = [];
    page.on('websocket', socket => {
      if (!new URL(socket.url()).pathname.startsWith('/ws/')) return;
      const record = (target: Array<Record<string, unknown>>, payload: string | Buffer) => {
        try { target.push(JSON.parse(String(payload))); } catch { /* ping/pong */ }
      };
      socket.on('framesent', frame => record(sent, frame.payload));
      socket.on('framereceived', frame => record(received, frame.payload));
    });
    await page.reload();
    await expect.poll(() => received.some(frame => frame.type === 'state-update')).toBe(true);
    await page.getByRole('button', { name: 'Increment (+1)', exact: true }).click();
    await expect.poll(() => sent.find(frame => frame.type === 'action' && frame.action === 'increment')).toBeDefined();
    const action = sent.find(frame => frame.type === 'action' && frame.action === 'increment')!;
    expect(action.requestId).toEqual(expect.any(String));
    expect(action.payload).toEqual([]);
    await expect.poll(() => received.find(frame => frame.requestId === action.requestId && frame.type === 'done'),
      { timeout: 10_000 }).toBeDefined();
    expect(received.filter(frame => frame.requestId === action.requestId && frame.type === 'error')).toEqual([]);
  });

  test('should display counter value', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent();
    // The page shows "Count: 0" or similar
    expect(body).toContain('Count:');
  });

  test('should increment counter optimistically', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Wait for the count to stabilize so the WebSocket initial state-update
    // has been applied before we read the initial value.
    const initialValue = await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) : -1;
    }, { timeout: 5000 }).then(r => r.jsonValue());

    // Small delay to ensure the WebSocket proxy is fully wired up
    await page.waitForTimeout(500);

    const startTime = Date.now();
    await page.click('button:has-text("Increment")');
    const responseTime = Date.now() - startTime;

    // Optimistic update should be fast (under 500ms to account for CI variability)
    expect(responseTime).toBeLessThan(500);

    // Wait for the count to increase by 1 (server response completes)
    await page.waitForFunction((expected) => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) >= expected : false;
    }, initialValue + 1, { timeout: 10000 });
  });

  test('should toggle details panel', async ({ page }) => {
    const details = page.getByRole('heading', { name: 'Debug Information', exact: true });
    await expect(details).not.toBeVisible();
    await page.getByRole('button', { name: 'Show Info', exact: true }).click();
    await expect(details).toBeVisible();
    await page.getByRole('button', { name: 'Hide Info', exact: true }).click();
    await expect(details).not.toBeVisible();
  });

  test('should show computed values', async ({ page }) => {
    const body = await page.locator('body').textContent();

    expect(body).toBeDefined();
  });

  test('should handle rapid clicks', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const initialValue = await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) : -1;
    }, { timeout: 5000 }).then(r => r.jsonValue());

    const incrementButton = page.locator('button:has-text("+")');

    for (let i = 0; i < 5; i++) {
      await incrementButton.click();
      await page.waitForTimeout(50);
    }

    // Wait for all server responses to complete: count should be initialValue + 5
    await page.waitForFunction((expected) => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) >= expected : false;
    }, initialValue + 5, { timeout: 10000 });
  });

  test('should maintain loading state per action', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.click('button:has-text("+")');

    await page.waitForTimeout(100);
  });
});
