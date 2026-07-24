import { test, expect } from '../fixtures';

test.describe('Refs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/refs');
  });

  test('should focus input on mount via @Ref', async ({ page }) => {
    const input = page.getByPlaceholder('I was focused automatically');
    await expect(input).toBeVisible();

    // Wait for hydration and onMount to run
    await page.waitForTimeout(100);

    // The input should be focused on mount
    await expect(input).toBeFocused();
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

    // Click the animate button
    await animateButton.click();

    // Wait for animation to complete
    await page.waitForTimeout(600);

    // Check that the status text updated (meaning the ref worked)
    const statusText = await page.locator('.status').textContent();
    expect(statusText).toContain('animated');
  });

  test('should have working refs that allow direct DOM access', async ({ page }) => {
    // Wait for refs to be set
    await page.waitForTimeout(200);

    // The refs should be working - status should be updated
    const statusText = await page.locator('.status').textContent();
    expect(statusText).not.toBe('Waiting for input...');
  });
});
