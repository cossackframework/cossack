import { expect, test } from '../fixtures';

test.describe('Renderer directives demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/renderer/directives');
    await page.waitForFunction(
      () => (window as typeof window & { __cossackReady?: boolean }).__cossackReady === true,
    );
  });

  test('uses UI buttons for directive controls', async ({ page }) => {
    const buttons = page.locator('main .cs-button');

    await expect(buttons).toHaveCount(11);
    await expect(page.getByRole('button', { name: 'Cycle status' })).toHaveClass(/cs-button--outline/);
  });

  test('keeps directive interactions working through UI buttons', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Toggle (on)' });

    await toggle.click();
    await expect(page.getByText('⭕ The switch is OFF.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle (off)' })).toBeVisible();

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('#4: Item 4')).toBeVisible();
  });
});
