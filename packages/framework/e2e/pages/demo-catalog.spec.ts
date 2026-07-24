import { test, expect } from '../fixtures';
import { demoEntries } from '../../src/demo-catalog';

test.describe('Demo catalog smoke test', () => {
  for (const entry of demoEntries) {
    test(`${entry.url} renders in the shared shell`, async ({ page }) => {
      const response = await page.goto(entry.url);
      expect(response?.status(), `${entry.url} should not return a server error`).toBeLessThan(500);
      await expect(page.locator('.cs-sidebar').first()).toBeAttached();
      await expect(page.locator('main').last()).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Internal Server Error');
    });
  }
});
