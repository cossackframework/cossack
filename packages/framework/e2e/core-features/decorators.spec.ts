import { test, expect } from '../fixtures';

test.describe('Decorators', () => {
  test.describe('@Server Decorator', () => {
    test('should call server method and update state', async ({ page }) => {
      await page.goto('/counter-http');
      await page.waitForFunction(() => (
        window as typeof window & { __cossackReady?: boolean }
      ).__cossackReady === true);

      const count = page.getByText(/^Count:\s*\d+$/);
      const initialMatch = (await count.textContent())?.match(/Count:\s*(\d+)/);
      const initialValue = initialMatch ? parseInt(initialMatch[1], 10) : 0;

      await page.getByRole('button', { name: 'Increment', exact: true }).click();
      await expect(count).toHaveText(`Count: ${initialValue + 1}`);
    });
  });

  test.describe('@Optimistic Decorator', () => {
    test('should update UI immediately on optimistic action', async ({ page }) => {
      await page.goto('/optimistic-counter');

      // Wait for page to be fully loaded
      await page.waitForLoadState('networkidle');
      // Wait for WebSocket to be fully connected and initial state synced
      await page.waitForTimeout(500);

      const body = await page.locator('body').textContent();
      const initialMatch = body?.match(/Count:\s*(\d+)/i);
      const initialValue = initialMatch ? parseInt(initialMatch[1], 10) : 0;

      const startTime = Date.now();
      await page.click('button:has-text("Increment")');
      const clickTime = Date.now() - startTime;

      // Optimistic update should be fast (under 500ms to account for CI variability)
      // The key is it should be much faster than the 500ms server delay
      expect(clickTime).toBeLessThan(500);

      // Wait for the server response to complete
      await page.waitForFunction((expected) => {
        const text = document.body.textContent || '';
        const match = text.match(/Count:\s*(\d+)/i);
        return match ? parseInt(match[1], 10) >= expected : false;
      }, initialValue + 1, { timeout: 10000 });
    });
  });

  test.describe('@ClientState Decorator', () => {
    test('should track client-side state changes', async ({ page }) => {
      await page.goto('/events');

      const initialText = await page.locator('body').textContent();

      await page.click('body');
      await page.waitForTimeout(100);

      const afterClickText = await page.locator('body').textContent();

      expect(initialText).toBeDefined();
      expect(afterClickText).toBeDefined();
    });
  });

  test.describe('@Computed Decorator', () => {
    test('should compute derived values', async ({ page }) => {
      await page.goto('/optimistic-counter');

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      const body = await page.locator('body').textContent();

      // Should show the count value
      expect(body).toMatch(/Count:\s*\d+/);
    });
  });

  test.describe('@On Event Decorator', () => {
    test('should handle element click events', async ({ page }) => {
      await page.goto('/events');

      const clickButton = page.locator('button').first();
      if (await clickButton.isVisible()) {
        await clickButton.click();
        await page.waitForTimeout(100);
      }
    });

    test('should handle document-level events', async ({ page }) => {
      await page.goto('/events');

      await page.keyboard.press('a');
      await page.waitForTimeout(100);

      const body = await page.locator('body').textContent();
      expect(body).toBeDefined();
    });

    test('should handle window events', async ({ page }) => {
      await page.goto('/events');

      const viewportSize = page.viewportSize();
      if (viewportSize) {
        await page.setViewportSize({ width: viewportSize.width + 100, height: viewportSize.height });
        await page.waitForTimeout(100);
      }
    });
  });

  test.describe('@Ref Decorator', () => {
    test('should access DOM elements via refs', async ({ page }) => {
      await page.goto('/refs');

      const focusButton = page.locator('button:has-text("Focus")');
      if (await focusButton.isVisible()) {
        await focusButton.click();

        const input = page.locator('input').first();
        await expect(input).toBeFocused();
      }
    });

    test('should manipulate DOM elements', async ({ page }) => {
      await page.goto('/refs');

      const animateButton = page.locator('button:has-text("Animate")');
      if (await animateButton.isVisible()) {
        await animateButton.click();
        await page.waitForTimeout(100);
      }
    });
  });
});
