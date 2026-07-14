import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Blocks Pages', () => {
  test('blocks index renders category cards', async ({ page }) => {
    await page.goto('/blocks');
    await expect(page.locator('h1:has-text("Blocks")')).toBeVisible();
    // Two category cards.
    await expect(page.locator('a[href="/blocks/login"]')).toBeVisible();
    await expect(page.locator('a[href="/blocks/dashboard"]')).toBeVisible();
  });

  test('login blocks render all 4 variations', async ({ page }) => {
    await page.goto('/blocks/login', { waitUntil: 'networkidle' });
    // Tab 0: Simple Card — visible by default.
    await expect(page.getByText('Login to your account')).toBeVisible();
    // Tab 1: Split Screen.
    await page.getByRole('button', { name: 'Split Screen' }).click();
    await expect(page.getByText('Sign in to continue')).toBeVisible({ timeout: 15000 });
    // Tab 2: Centered + Logo.
    await page.getByRole('button', { name: 'Centered + Logo' }).click();
    await expect(page.getByText('Remember me')).toBeVisible({ timeout: 15000 });
    // Tab 3: Split Card.
    await page.getByRole('button', { name: 'Split Card' }).click();
    await expect(page.getByText('Or continue with')).toBeVisible({ timeout: 15000 });
  });

  test('dashboard blocks render all 4 variations', async ({ page }) => {
    await page.goto('/blocks/dashboard', { waitUntil: 'networkidle' });
    // Tab 0: Stats + Table.
    await expect(page.getByText('Recent Orders')).toBeVisible();
    await expect(page.getByText('INV-001')).toBeVisible();
    // Tab 1: Sidebar Shell.
    await page.getByRole('button', { name: 'Sidebar Shell' }).click();
    await expect(page.getByText('Overview').first()).toBeVisible({ timeout: 15000 });
    // Tab 2: Analytics.
    await page.getByRole('button', { name: 'Analytics' }).click();
    await expect(page.getByText('Weekly Traffic')).toBeVisible({ timeout: 15000 });
    // Tab 3: Team Overview.
    await page.getByRole('button', { name: 'Team Overview' }).click();
    await expect(page.getByText('Alice Johnson')).toBeVisible({ timeout: 15000 });
  });

  test('dashboard table filters via search (bind + Store)', async ({ page }) => {
    await page.goto('/blocks/dashboard', { waitUntil: 'networkidle' });
    // All 5 orders visible initially.
    await expect(page.getByText('5 transactions')).toBeVisible();
    // Type in search → filters the reactive store.
    await page.getByPlaceholder('Search orders...').fill('Alice');
    // Only Alice's row remains.
    await expect(page.getByText('1 transaction')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('INV-001')).toBeVisible();
    await expect(page.getByText('INV-002')).toBeHidden();
    // Clear search → all rows back.
    await page.getByPlaceholder('Search orders...').fill('');
    await expect(page.getByText('5 transactions')).toBeVisible({ timeout: 10000 });
  });

  test('login form validates and submits (bind + preventDefault + @Validate)', async ({ page }) => {
    await page.goto('/blocks/login', { waitUntil: 'networkidle' });
    // Submit empty → validation errors appear.
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page.getByText('Enter a valid email')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('At least 8 characters')).toBeVisible();
    // Wait for the button to re-enable after the server call completes.
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeEnabled({ timeout: 10000 });
    // Fill valid credentials via bind().
    await page.locator('#email').fill('admin@acme.dev');
    await page.locator('#email').blur();
    await page.locator('#password').fill('password123');
    await page.locator('#password').blur();
    // Errors clear after valid input + blur.
    await expect(page.getByText('Enter a valid email')).toBeHidden({ timeout: 10000 });
    // Submit → success banner.
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page.getByText('Logged in as')).toBeVisible({ timeout: 15000 });
  });
});
