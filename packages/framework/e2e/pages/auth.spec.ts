import { test, expect } from '../fixtures';

test.describe('Authentication Pages', () => {
  test.describe('Login Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
    });

    test('should display login form', async ({ page }) => {
      await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('should have link to register page', async ({ page }) => {
      const registerLink = page.locator('a[href="/register"]');

      if (await registerLink.isVisible()) {
        await registerLink.click();
        await page.waitForURL('/register');
      }
    });

    test('should submit login form', async ({ page }) => {
      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      const passwordInput = page.locator('input[type="password"]').first();

      await emailInput.fill('test@example.com');
      await passwordInput.fill('password123');

      const submitButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      if (await submitButton.isVisible()) {
        await submitButton.click();
        await page.waitForTimeout(500);
      }
    });
  });

  test.describe('Register Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/register');
    });

    test('should display registration form', async ({ page }) => {
      await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('should have link to login page', async ({ page }) => {
      const loginLink = page.locator('a[href="/login"]');

      if (await loginLink.isVisible()) {
        await loginLink.click();
        await page.waitForURL('/login');
      }
    });

    test('should submit registration form', async ({ page }) => {
      const nameInput = page.locator('input[name="name"], input[name="fullName"]').first();
      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      const passwordInput = page.locator('input[type="password"]').first();

      if (await nameInput.isVisible()) {
        await nameInput.fill('Test User');
      }

      await emailInput.fill('newuser@example.com');
      await passwordInput.fill('SecurePass123!');

      const submitButton = page.locator('button[type="submit"], button:has-text("Register"), button:has-text("Sign up")');
      if (await submitButton.isVisible()) {
        await submitButton.click();
        await page.waitForTimeout(500);
      }
    });
  });

  test('should navigate between login and register pages', async ({ page }) => {
    await page.goto('/login');

    const registerLink = page.locator('a[href="/register"]');
    if (await registerLink.isVisible()) {
      await registerLink.click();
      await expect(page).toHaveURL('/register');

      const loginLink = page.locator('a[href="/login"]');
      if (await loginLink.isVisible()) {
        await loginLink.click();
        await expect(page).toHaveURL('/login');
      }
    }
  });
});
