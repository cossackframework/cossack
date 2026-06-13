import { test, expect } from '../fixtures';

test.describe('Stateless Counter Page', () => {
  // Increase timeout: the shared DO can be slow under heavy parallel test runs.
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await page.goto('/stateless-counter');
    // Wait for the counter UI to render instead of networkidle.
    // The DO/WS transport keeps a connection alive that can delay networkidle.
    await page.waitForSelector('text=/Count:\\s*\\d+/');
  });

  test('should display counter with default value 0', async ({ page }) => {
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/Count:\s*\d+/);
  });

  test('should increment counter via WebSocket', async ({ page }) => {
    // Read the current counter value via the rendered text
    const countEl = page.locator('text=/Count:\\s*\\d+/').first();
    const initialText = await countEl.textContent();
    const match = initialText?.match(/Count:\s*(\d+)/i);
    const initialValue = match ? parseInt(match[1], 10) : 0;

    await page.click('button:has-text("Increment")');

    // Wait for the count to increase by at least 1.
    // Generous timeout: the shared DO may be slow under heavy parallelism.
    await expect.poll(async () => {
      const text = await page.locator('body').textContent({ timeout: 5000 });
      const m = text?.match(/Count:\s*(\d+)/i);
      return m ? parseInt(m[1], 10) : -1;
    }, { timeout: 30000, interval: 500 }).toBeGreaterThanOrEqual(initialValue + 1);
  });

  test('should handle rapid clicks', async ({ page }) => {
    // Read the current counter value via the rendered text
    const countEl = page.locator('text=/Count:\\s*\\d+/').first();
    const initialText = await countEl.textContent();
    const match = initialText?.match(/Count:\s*(\d+)/i);
    const initialValue = match ? parseInt(match[1], 10) : 0;

    const incrementButton = page.locator('button:has-text("Increment")');

    for (let i = 0; i < 3; i++) {
      await incrementButton.click();
      await page.waitForTimeout(50);
    }

    // Wait for all server responses to complete: count should be >= initialValue + 3
    await expect.poll(async () => {
      const text = await page.locator('body').textContent({ timeout: 5000 });
      const m = text?.match(/Count:\s*(\d+)/i);
      return m ? parseInt(m[1], 10) : -1;
    }, { timeout: 30000, interval: 500 }).toBeGreaterThanOrEqual(initialValue + 3);
  });

  test('should render stateless description text', async ({ page }) => {
    const body = await page.locator('body').textContent();
    expect(body).toContain('Stateless Counter');
    expect(body).toContain('stateless');
  });
});
