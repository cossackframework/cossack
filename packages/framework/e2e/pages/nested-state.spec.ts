import { test, expect } from '../fixtures';

test.describe('Nested State Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/nested-state');
  });

  test('should display nested components', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
    // Should have 3 nested counters
    const counters = page.locator('h4:has-text("Nested Counter")');
    await expect(counters).toHaveCount(3);
  });

  test('should increment counter on button click', async ({ page }) => {
    // Get all increment buttons and use the first one
    const incrementButtons = page.getByRole('button', { name: 'Increment' });
    const countTexts = page.getByText(/Count:/);

    // Initial count should be 0
    await expect(countTexts.nth(0)).toContainText('Count: 0');

    // Click increment on first counter
    await incrementButtons.nth(0).click();

    // Wait for the update and verify count increased to 1
    await expect(countTexts.nth(0)).toContainText('Count: 1', { timeout: 5000 });
  });

  test('should maintain isolated state between nested components', async ({ page }) => {
    const incrementButtons = page.getByRole('button', { name: 'Increment' });
    const countTexts = page.getByText(/Count:/);

    // Both should start at 0
    await expect(countTexts.nth(0)).toContainText('Count: 0');
    await expect(countTexts.nth(1)).toContainText('Count: 0');

    // Click increment on the first counter only
    await incrementButtons.nth(0).click();

    // First counter should be 1, second should still be 0
    await expect(countTexts.nth(0)).toContainText('Count: 1', { timeout: 5000 });
    await expect(countTexts.nth(1)).toContainText('Count: 0');

    // Click increment on the second counter
    await incrementButtons.nth(1).click();

    // First should still be 1, second should be 1
    await expect(countTexts.nth(0)).toContainText('Count: 1');
    await expect(countTexts.nth(1)).toContainText('Count: 1', { timeout: 5000 });
  });

  test('should handle multiple increments on same component', async ({ page }) => {
    const incrementButton = page.getByRole('button', { name: 'Increment' }).first();
    const countText = page.getByText(/Count:/).first();

    // Click increment 3 times
    await incrementButton.click();
    await expect(countText).toContainText('Count: 1', { timeout: 5000 });

    await incrementButton.click();
    await expect(countText).toContainText('Count: 2', { timeout: 5000 });

    await incrementButton.click();
    await expect(countText).toContainText('Count: 3', { timeout: 5000 });
  });
});
