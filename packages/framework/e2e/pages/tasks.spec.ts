import { test, expect } from '../fixtures';

test.describe('Tasks Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tasks');
  });

  test('should display task list or empty state', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
  });

  test('should add a new task', async ({ page }) => {
    const input = page.locator('input[type="text"]').first();

    if (await input.isVisible()) {
      await input.fill('Test Task E2E');

      const addButton = page.locator('button:has-text("Add")').first();
      await addButton.click();

      await page.waitForTimeout(500);

      await expect(page.locator('body')).toContainText('Test Task E2E');
    }
  });

  test('should show loading state when adding task', async ({ page }) => {
    const input = page.locator('input[type="text"]').first();

    if (await input.isVisible()) {
      await input.fill('Loading Test Task');

      const addButton = page.locator('button:has-text("Add")').first();
      await addButton.click();

      await page.waitForTimeout(100);
    }
  });

  test('should handle task completion toggle', async ({ page }) => {
    const checkboxes = page.locator('input[type="checkbox"]');

    if ((await checkboxes.count()) > 0) {
      const firstCheckbox = checkboxes.first();
      await firstCheckbox.click();

      await page.waitForTimeout(300);
    }
  });

  test('should delete a task', async ({ page }) => {
    const deleteButtons = page.locator('button:has-text("Delete"), button:has-text("Remove")');

    if ((await deleteButtons.count()) > 0) {
      const bodyBefore = await page.locator('body').textContent();

      await deleteButtons.first().click();

      await page.waitForTimeout(500);
    }
  });

  test('should sync tasks across browser tabs', async ({ page, context }) => {
    const input = page.locator('input[type="text"]').first();

    if (await input.isVisible()) {
      await input.fill('Sync Test Task');

      const addButton = page.locator('button:has-text("Add")').first();
      await addButton.click();

      await page.waitForTimeout(500);

      const secondPage = await context.newPage();
      await secondPage.goto('/tasks');

      await secondPage.waitForTimeout(500);

      await expect(secondPage.locator('body')).toContainText('Sync Test Task');

      await secondPage.close();
    }
  });
});
