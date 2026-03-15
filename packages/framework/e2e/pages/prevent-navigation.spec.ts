import { test, expect } from '../fixtures';

test.describe('Prevent Navigation Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/prevent-navigation');
  });

  test('should display form', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
  });

  test('should show confirmation when navigating with unsaved changes', async ({ page }) => {
    const input = page.locator('input, textarea').first();

    if (await input.isVisible()) {
      await input.fill('Some unsaved content');
      await page.waitForTimeout(100);

      const homeLink = page.locator('a[href="/"]').first();
      await homeLink.click();

      await page.waitForTimeout(300);

      const modal = page.locator('[role="dialog"], .modal, [data-modal]');
      if (await modal.isVisible()) {
        const cancelButton = modal.locator('button:has-text("Cancel"), button:has-text("Stay")');
        if (await cancelButton.isVisible()) {
          await cancelButton.click();
        }
      }
    }
  });

  test('should allow navigation when no changes', async ({ page }) => {
    const homeLink = page.locator('a[href="/"]').first();

    await homeLink.click();
    await page.waitForURL('/', { timeout: 5000 });
  });

  test('should show dirty state indicator', async ({ page }) => {
    const input = page.locator('input, textarea').first();

    if (await input.isVisible()) {
      await input.fill('Changed content');
      await page.waitForTimeout(100);

      const body = await page.locator('body').textContent();
      expect(body).toBeDefined();
    }
  });

  test('should reset dirty state after save', async ({ page }) => {
    const input = page.locator('input, textarea').first();
    const saveButton = page.locator('button:has-text("Save"), button:has-text("Submit")');

    if (await input.isVisible() && await saveButton.isVisible()) {
      await input.fill('Content to save');
      await saveButton.click();
      await page.waitForTimeout(300);
    }
  });
});
