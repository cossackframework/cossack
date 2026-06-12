import { test, expect } from '../fixtures';

test.describe('SSE Chat Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sse-chat');
  });

  test('should render chat UI', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toHaveText('SSE Chat');
    await expect(page.locator('input[type="text"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should send a message and show user bubble', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="text"]', 'Hello SSE!');
    await page.click('button[type="submit"]');

    // User message should appear immediately
    await expect(page.locator('.msg.user .bubble')).toHaveText('Hello SSE!');
    // Input should be cleared
    await expect(page.locator('input[type="text"]')).toHaveValue('');
  });

  test('should stream bot response via SSE', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="text"]', 'Hello');
    await page.click('button[type="submit"]');

    // Streaming indicator should appear (blinking cursor)
    await expect(page.locator('.msg.assistant.streaming')).toBeVisible({ timeout: 5000 });

    // Wait for streaming to complete (5 sentences × 1s + margin)
    await expect(page.locator('.msg.assistant.streaming')).toBeHidden({ timeout: 15000 });

    // Final assistant message should be visible as a complete bubble
    const assistantMessages = page.locator('.msg.assistant:not(.streaming) .bubble');
    await expect(assistantMessages).toHaveCount(1);

    const text = await assistantMessages.first().textContent();
    expect(text).toContain('Cossack SSE chat demo');
    expect(text).toContain('real time');
  });

  test('should disable input while streaming', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="text"]', 'Hello');
    await page.click('button[type="submit"]');

    // Input and button should be disabled during streaming
    await expect(page.locator('input[type="text"]')).toBeDisabled();
    await expect(page.locator('button[type="submit"]')).toBeDisabled();

    // Wait for streaming to finish
    await expect(page.locator('.msg.assistant.streaming')).toBeHidden({ timeout: 15000 });

    // Input and button should be re-enabled
    await expect(page.locator('input[type="text"]')).toBeEnabled();
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
  });
});
