import { test, expect, type Page } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

/** Blur the discount field and wait for its customAsync server RPC to return. */
async function blurAndValidate(page: Page) {
  const rpc = page.waitForResponse(r => new URL(r.url()).pathname === '/crpc'
    && (r.request().postData() ?? '').includes('validateDiscountCode'));
  await page.locator('input#discountCode').blur();
  expect((await rpc).ok()).toBe(true);
}

test.describe('Validation Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/validation');
    await page.waitForSelector('text=Validation Demo');
    await waitForHydration(page);
  });

  test('should display validation form', async ({ page }) => {

    // Check that the form is visible
    const form = page.locator('form');
    await expect(form).toBeVisible();

    // Check that all input fields are present
    const emailInput = page.locator('input#email');
    const passwordInput = page.locator('input#password');
    const usernameInput = page.locator('input#username');
    const ageInput = page.locator('input#age');
    const websiteInput = page.locator('input#website');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(usernameInput).toBeVisible();
    await expect(ageInput).toBeVisible();
    await expect(websiteInput).toBeVisible();
  });

  test('should show error on empty required field blur', async ({ page }) => {

const emailInput = page.locator('input#email');

    // Click and blur without entering anything
    await emailInput.focus();
    await emailInput.blur();

    // Should show error message
    const errorMessage = page.locator('text=Please enter a valid email address');
    await expect(errorMessage).toBeVisible();
  });

  test('should show error on invalid email format', async ({ page }) => {

const emailInput = page.locator('input#email');

    // Enter invalid email
    await emailInput.fill('notanemail');
    await emailInput.blur();

    // Should show error message
    const errorMessage = page.locator('text=Please enter a valid email address');
    await expect(errorMessage).toBeVisible();
  });

  test('should clear error on valid email input', async ({ page }) => {

const emailInput = page.locator('input#email');

    // First enter invalid email to trigger error
    await emailInput.fill('notanemail');
    await emailInput.blur();

    // Error should be visible
    const errorMessage = page.locator('text=Please enter a valid email address');
    await expect(errorMessage).toBeVisible();

    // Now enter valid email
    await emailInput.fill('test@example.com');
    await emailInput.blur();

    // Error should be gone
    await expect(errorMessage).not.toBeVisible();
  });

  test('should show error on short password', async ({ page }) => {

const passwordInput = page.locator('input#password');

    // Enter short password
    await passwordInput.fill('123');
    await passwordInput.blur();

    // Should show error message
    const errorMessage = page.locator('text=Password must be at least 8 characters');
    await expect(errorMessage).toBeVisible();
  });

  test('should show error on invalid username pattern', async ({ page }) => {

const usernameInput = page.locator('input#username');

    // Enter username with special characters
    await usernameInput.fill('user@name');
    await usernameInput.blur();

    // Should show error message
    const errorMessage = page.locator('text=Username can only contain letters, numbers, and underscores');
    await expect(errorMessage).toBeVisible();
  });

  test('should show error on invalid age', async ({ page }) => {

const ageInput = page.locator('input#age');

    // Enter age below minimum
    await ageInput.fill('10');
    await ageInput.blur();

    // Should show error message
    const errorMessage = page.locator('text=Please enter a valid age');
    await expect(errorMessage).toBeVisible();
  });

  test('should show error on invalid website URL', async ({ page }) => {

const websiteInput = page.locator('input#website');

    // Enter invalid URL
    await websiteInput.fill('not-a-url');
    await websiteInput.blur();

    // Should show error message
    const errorMessage = page.locator('text=Please enter a valid URL');
    await expect(errorMessage).toBeVisible();
  });

  test('should submit form when all fields are valid', async ({ page }) => {

// Fill in all valid data (without optional discount code)
    await page.locator('input#email').fill('test@example.com');
    await page.locator('input#password').fill('password123');
    await page.locator('input#username').fill('testuser');
    await page.locator('input#age').fill('25');
    await page.locator('input#website').fill('https://example.com');

    // Submit the form directly without triggering individual field validation
    // The validateAll() in handleSubmit will validate all fields at once
    await page.locator('button[type="submit"]').click();

    // Should show success message
    const successMessage = page.getByText('Form submitted successfully!');
    await expect(successMessage).toBeVisible();
  });

  test('should not submit form with validation errors', async ({ page }) => {

// Leave fields empty and try to submit
    await page.locator('button[type="submit"]').click();

    // validateAll() rendered the errors, so submission was refused.
    await expect(page.locator('input#email')).toHaveAttribute('aria-invalid', 'true');
    const successMessage = page.locator('text=Form submitted successfully!');
    await expect(successMessage).not.toBeVisible();
  });

  test('should validate on input event', async ({ page }) => {

const emailInput = page.locator('input#email');

    // Enter invalid email (should trigger validation on input)
    await emailInput.fill('notanemail');

    // Error should be visible (validation runs on input with trigger='all')
    const errorMessage = page.locator('text=Please enter a valid email address');
    await expect(errorMessage).toBeVisible();
  });

  test('should validate discount code with customAsync (server call)', async ({ page }) => {

const discountInput = page.locator('input#discountCode');

    // Enter an invalid discount code
    await discountInput.fill('INVALID');
    await blurAndValidate(page);

    // Should show error
    const errorMessage = page.locator('text=Invalid discount code');
    await expect(errorMessage).toBeVisible();
  });

  test('should accept valid discount code with customAsync', async ({ page }) => {

const discountInput = page.locator('input#discountCode');

    // Enter a valid discount code
    await discountInput.fill('SAVE10');
    await blurAndValidate(page);

    // Should NOT show error
    const errorMessage = page.locator('text=Invalid discount code');
    await expect(errorMessage).not.toBeVisible();
    await expect(discountInput).toHaveAttribute('aria-invalid', 'false');
  });

  test('should accept different valid discount codes', async ({ page }) => {

const discountInput = page.locator('input#discountCode');
    const errorMessage = page.locator('text=Invalid discount code');

    // Test SAVE20
    await discountInput.fill('SAVE20');
    await blurAndValidate(page);
    await expect(errorMessage).not.toBeVisible();

    // Test WELCOME
    await discountInput.fill('WELCOME');
    await blurAndValidate(page);
    await expect(errorMessage).not.toBeVisible();

    // Test VIP50
    await discountInput.fill('VIP50');
    await blurAndValidate(page);
    await expect(errorMessage).not.toBeVisible();
  });

  test('should allow empty optional discount code', async ({ page }) => {

const discountInput = page.locator('input#discountCode');

    // Leave empty (field is not required)
    // Make the field invalid first so "no error" proves the empty value was
    // validated (customAsync short-circuits empty values without an RPC).
    await discountInput.fill('INVALID');
    await blurAndValidate(page);
    await expect(page.locator('text=Invalid discount code')).toBeVisible();
    await discountInput.fill('');
    await discountInput.blur();

    // Should NOT show error for empty optional field
    const errorMessage = page.locator('text=Invalid discount code');
    await expect(errorMessage).not.toBeVisible();
  });

  test('should not validate discount code on input', async ({ page }) => {

const discountInput = page.locator('input#discountCode');

    // Type an invalid discount code character-by-character (input events).
    // The field is configured with trigger: 'blur', so async validation
    // should NOT fire on each keystroke.
    const rpcs: string[] = [];
    page.on('request', request => {
      if ((request.postData() ?? '').includes('validateDiscountCode')) rpcs.push(request.url());
    });
    await discountInput.click();
    await discountInput.pressSequentially('INVALID', { delay: 20 });
    await expect(discountInput).toHaveValue('INVALID');

    const errorMessage = page.locator('text=Invalid discount code');
    // Blurring triggers exactly one validation RPC; keystrokes triggered none.
    await blurAndValidate(page);
    await expect(errorMessage).toBeVisible();
    expect(rpcs).toHaveLength(1);
  });

  test('should submit form with valid discount code', async ({ page }) => {
    await page.waitForSelector('text=Validation Demo');

    // Fill in all valid data including discount code
    await page.locator('input#email').fill('test@example.com');
    await page.locator('input#password').fill('password123');
    await page.locator('input#username').fill('testuser');
    await page.locator('input#age').fill('25');
    await page.locator('input#website').fill('https://example.com');
    await page.locator('input#discountCode').fill('SAVE10');

    // Blur the discount code field and wait for its async server validation.
    await blurAndValidate(page);
    await expect(page.locator('text=Invalid discount code')).not.toBeVisible();

    await page.locator('button[type="submit"]').click();

    await expect(page.locator('text=Form submitted successfully!')).toBeVisible({ timeout: 10000 });

    const submittedData = page.locator('pre');
    await expect(submittedData).toContainText('SAVE10');
  });
});
