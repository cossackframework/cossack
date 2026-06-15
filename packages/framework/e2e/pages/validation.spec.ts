import { test, expect } from '../fixtures';

test.describe('Validation Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/validation');
    await page.waitForSelector('text=Validation Demo');
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

    // Wait for form submission and async validation
    await page.waitForTimeout(2000);

    // Should show success message
    const successMessage = page.locator('text=Form submitted successfully!');
    await expect(successMessage).toBeVisible();
  });

  test('should not submit form with validation errors', async ({ page }) => {

// Leave fields empty and try to submit
    await page.locator('button[type="submit"]').click();

    await page.waitForTimeout(500);

    // Should show errors (not success)
    const successMessage = page.locator('text=Form submitted successfully!');
    await expect(successMessage).not.toBeVisible();
  });

  test('should validate on input event', async ({ page }) => {

const emailInput = page.locator('input#email');

    // Enter invalid email (should trigger validation on input)
    await emailInput.fill('notanemail');

    // Wait a bit for validation to run
    await page.waitForTimeout(100);

    // Error should be visible (validation runs on input with trigger='all')
    const errorMessage = page.locator('text=Please enter a valid email address');
    await expect(errorMessage).toBeVisible();
  });

  test('should validate discount code with customAsync (server call)', async ({ page }) => {

const discountInput = page.locator('input#discountCode');

    // Enter an invalid discount code
    await discountInput.fill('INVALID');
    await discountInput.blur();

    // Wait for async validation
    await page.waitForTimeout(300);

    // Should show error
    const errorMessage = page.locator('text=Invalid discount code');
    await expect(errorMessage).toBeVisible();
  });

  test('should accept valid discount code with customAsync', async ({ page }) => {

const discountInput = page.locator('input#discountCode');

    // Enter a valid discount code
    await discountInput.fill('SAVE10');
    await discountInput.blur();

    // Wait for async validation
    await page.waitForTimeout(500);

    // Should NOT show error
    const errorMessage = page.locator('text=Invalid discount code');
    await expect(errorMessage).not.toBeVisible();
  });

  test('should accept different valid discount codes', async ({ page }) => {

const discountInput = page.locator('input#discountCode');
    const errorMessage = page.locator('text=Invalid discount code');

    // Test SAVE20
    await discountInput.fill('SAVE20');
    await discountInput.blur();
    await page.waitForTimeout(300);
    await expect(errorMessage).not.toBeVisible();

    // Test WELCOME
    await discountInput.fill('WELCOME');
    await discountInput.blur();
    await page.waitForTimeout(300);
    await expect(errorMessage).not.toBeVisible();

    // Test VIP50
    await discountInput.fill('VIP50');
    await discountInput.blur();
    await page.waitForTimeout(300);
    await expect(errorMessage).not.toBeVisible();
  });

  test('should allow empty optional discount code', async ({ page }) => {

const discountInput = page.locator('input#discountCode');

    // Leave empty (field is not required)
    await discountInput.fill('');
    await discountInput.blur();

    // Wait for validation
    await page.waitForTimeout(300);

    // Should NOT show error for empty optional field
    const errorMessage = page.locator('text=Invalid discount code');
    await expect(errorMessage).not.toBeVisible();
  });

  test('should not validate discount code on input', async ({ page }) => {

const discountInput = page.locator('input#discountCode');

    // Type an invalid discount code character-by-character (input events).
    // The field is configured with trigger: 'blur', so async validation
    // should NOT fire on each keystroke.
    await discountInput.click();
    await discountInput.type('INVALID', { delay: 20 });

    // Wait long enough that any (incorrectly triggered) async validation
    // would have completed. Server-side customAsync sleeps ~100ms.
    await page.waitForTimeout(400);

    // No error should be visible yet — validation only fires on blur.
    const errorMessage = page.locator('text=Invalid discount code');
    await expect(errorMessage).not.toBeVisible();

    // Blurring should now trigger validation and reveal the error.
    await discountInput.blur();
    await expect(errorMessage).toBeVisible({ timeout: 2000 });
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

    // Blur the discount code field to trigger its async server validation,
    // then wait for it to complete before submitting.
    await page.locator('input#discountCode').blur();
    await expect(page.locator('text=Invalid discount code')).not.toBeVisible({ timeout: 5000 });

    await page.locator('button[type="submit"]').click();

    await expect(page.locator('text=Form submitted successfully!')).toBeVisible({ timeout: 10000 });

    const submittedData = page.locator('pre');
    await expect(submittedData).toContainText('SAVE10');
  });
});
