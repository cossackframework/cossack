import { test, expect } from '@playwright/test';

test.describe('Refs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/refs');
  });

  test('should focus input on mount via @Ref', async ({ page }) => {
    const input = page.getByPlaceholder('I was focused automatically');
    await expect(input).toBeVisible();

    // onMount focuses the input through the ref (auto-retries until it runs).
    await expect(input).toBeFocused();
    await expect(page.locator('.status')).toHaveText('Input focused via Ref!');
  });

  test('should animate element via @Ref when button clicked', async ({ page }) => {
    const animateButton = page.locator('button:has-text("Animate Box")');
    const targetBox = page.locator('.target-box');

    await expect(animateButton).toBeVisible();
    await expect(targetBox).toBeVisible();

    // Wait for hydration + onMount to complete. onMount sets a 2px solid green
    // border on the target box via boxRef after a 100ms timer, which is a
    // reliable signal that the client bundle has hydrated, the @click listener
    // is attached, and boxRef.value is populated. Clicking before this runs
    // risks firing on an un-hydrated button (no listener) and flakes the test.
    await expect(targetBox).toHaveCSS('border-color', 'rgb(0, 128, 0)', { timeout: 5000 });

    await animateButton.click();

    // The handler reached the element through boxRef and started a Web Animation.
    await expect(page.locator('.status')).toHaveText('Box animated via direct DOM access!');
    expect(await targetBox.evaluate(el => el.getAnimations().length)).toBeGreaterThan(0);
  });

  test('should have working refs that allow direct DOM access', async ({ page }) => {
    // onMount updates the status through a ref once hydration completes.
    await expect(page.locator('.status')).not.toHaveText('Waiting for input...');
  });
});
