import { test, expect } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

test.describe('Prevent Navigation Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/prevent-navigation');
    await waitForHydration(page);
  });

  test('renders a clean form with no unsaved-changes warning', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Prevent Navigation Demo' })).toBeVisible();
    await expect(page.getByPlaceholder('Type something...')).toHaveValue('');
    await expect(page.getByText('You have unsaved changes')).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('typing marks the form dirty and echoes the input', async ({ page }) => {
    await page.getByPlaceholder('Type something...').fill('Changed content');
    await expect(page.getByText('You have unsaved changes')).toBeVisible();
    await expect(page.getByText('Current Input:')).toContainText('Changed content');
  });

  test('clearing the input resets the dirty state and allows navigation', async ({ page }) => {
    const input = page.getByPlaceholder('Type something...');
    await input.fill('temporary');
    await expect(page.getByText('You have unsaved changes')).toBeVisible();
    await input.fill('');
    await expect(page.getByText('You have unsaved changes')).toHaveCount(0);

    await page.getByRole('link', { name: /Go Home/ }).click();
    await page.waitForURL('/');
  });

  test('allows navigation when there are no changes', async ({ page }) => {
    await page.getByRole('link', { name: /Go Home/ }).click();
    await page.waitForURL('/');
  });

  test('blocks navigation with unsaved changes; "Stay" keeps the page', async ({ page }) => {
    await page.getByPlaceholder('Type something...').fill('Some unsaved content');
    await expect(page.getByText('You have unsaved changes')).toBeVisible();

    await page.getByRole('link', { name: /Go Home/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Unsaved changes');

    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/prevent-navigation$/);
    await expect(page.getByPlaceholder('Type something...')).toHaveValue('Some unsaved content');
  });

  test('"Leave without saving" completes the blocked navigation', async ({ page }) => {
    await page.getByPlaceholder('Type something...').fill('Some unsaved content');
    await expect(page.getByText('You have unsaved changes')).toBeVisible();

    await page.getByRole('link', { name: /Go Home/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Leave without saving' }).click();
    await page.waitForURL('/');
  });
});
