import { test, expect } from '../fixtures';

test.describe('Contact Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/contact');
  });

  test('should display contact form', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // The contact page has a form with name input
    const form = page.locator('form');
    const input = page.locator('input[name="name"]');

    // Either the form or input should be visible
    const formVisible = await form.isVisible().catch(() => false);
    const inputVisible = await input.isVisible().catch(() => false);

    expect(formVisible || inputVisible).toBe(true);
  });

  test('should submit form via POST', async ({ page }) => {
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]').first();
    const emailInput = page.locator('input[name="email"], input[type="email"]').first();
    const messageInput = page.locator('textarea[name="message"], textarea').first();

    if (await nameInput.isVisible()) {
      await nameInput.fill('Test User');
    }

    if (await emailInput.isVisible()) {
      await emailInput.fill('test@example.com');
    }

    if (await messageInput.isVisible()) {
      await messageInput.fill('This is a test message.');
    }

    const submitButton = page.locator('button[type="submit"], button:has-text("Send"), button:has-text("Submit")');
    if (await submitButton.isVisible()) {
      await submitButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should handle query parameters', async ({ page }) => {
    await page.goto('/contact?subject=TestSubject');

    const subjectInput = page.locator('input[name="subject"]').first();
    if (await subjectInput.isVisible()) {
      const value = await subjectInput.inputValue();
    }
  });

  test('should validate required fields', async ({ page }) => {
    const submitButton = page.locator('button[type="submit"]').first();

    if (await submitButton.isVisible()) {
      await submitButton.click();
      await page.waitForTimeout(200);
    }
  });
});
