import { test, expect } from '@playwright/test';

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
      const registerLink = page.getByRole('main').getByRole('link', { name: 'Register', exact: true });
      await expect(registerLink).toBeVisible();
      await registerLink.click();
      await page.waitForURL('/register');
    });

    test('should expose labelled fields; Sign In is a non-submitting demo button', async ({ page }) => {
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password').fill('password123');
      await expect(page.getByLabel('Email')).toHaveValue('test@example.com');
      await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');

      const signIn = page.getByRole('button', { name: 'Sign In' });
      await expect(signIn).toHaveAttribute('type', 'button');
      await signIn.click();
      // The demo form has no handler: clicking must not submit/navigate.
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByLabel('Email')).toHaveValue('test@example.com');
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
      const loginLink = page.getByRole('main').getByRole('link', { name: 'Login', exact: true });
      await expect(loginLink).toBeVisible();
      await loginLink.click();
      await page.waitForURL('/login');
    });

    test('should expose labelled fields; Register is a non-submitting demo button', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
      await page.getByLabel('Full name').fill('Test User');
      await page.getByLabel('Email').fill('newuser@example.com');
      await page.getByLabel('Password').fill('SecurePass123!');
      await expect(page.getByLabel('Full name')).toHaveValue('Test User');

      const register = page.getByRole('main').getByRole('button', { name: 'Register' });
      await expect(register).toHaveAttribute('type', 'button');
      await register.click();
      await expect(page).toHaveURL(/\/register$/);
      await expect(page.getByLabel('Email')).toHaveValue('newuser@example.com');
    });
  });

  test('should navigate between login and register pages', async ({ page }) => {
    await page.goto('/login');

    const registerLink = page.getByRole('main').getByRole('link', { name: 'Register', exact: true });
    await registerLink.click();
    await expect(page).toHaveURL('/register');

    const loginLink = page.getByRole('main').getByRole('link', { name: 'Login', exact: true });
    await loginLink.click();
    await expect(page).toHaveURL('/login');
  });
});
