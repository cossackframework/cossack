import { test, expect } from '../fixtures';

test.describe('DI Demo Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/di-demo');
  });

  test('should render the page with injected service', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent();
    expect(body).toContain('Dependency Injection Demo');
    expect(body).toContain('Count: 0');
  });

  test('should increment counter via service', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Verify initial state
    const body = await page.locator('body').textContent();
    expect(body).toContain('Count: 0');

    // Click increment
    await page.click('button:has-text("+")');

    // Wait for the count to update to 1
    await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/);
      return match ? parseInt(match[1], 10) === 1 : false;
    });

    const afterIncrement = await page.locator('body').textContent();
    expect(afterIncrement).toContain('Count: 1');
  });

  test('should decrement counter via service', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // First increment to 1
    await page.click('button:has-text("+")');
    await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/);
      return match ? parseInt(match[1], 10) === 1 : false;
    });

    // Now decrement back to 0
    await page.click('button:has-text("-")');
    await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/);
      return match ? parseInt(match[1], 10) === 0 : false;
    });

    const afterDecrement = await page.locator('body').textContent();
    expect(afterDecrement).toContain('Count: 0');
  });

  test('should handle multiple increments', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click increment 3 times
    for (let i = 0; i < 3; i++) {
      await page.click('button:has-text("+")');
      await page.waitForFunction((expected) => {
        const text = document.body.textContent || '';
        const match = text.match(/Count:\s*(\d+)/);
        return match ? parseInt(match[1], 10) === expected : false;
      }, i + 1);
    }

    const body = await page.locator('body').textContent();
    expect(body).toContain('Count: 3');
  });
});
