import { test, expect } from '../fixtures';

test.describe('SSE Chat Page', () => {
  // Each test navigates to its own unique room to avoid SSE state leaking
  // between tests or from previous runs. SSE state persists server-side per
  // scope key (room), so shared rooms cause cross-test interference.
  let roomCounter = 0;
  const nextRoom = () => `e2e-chat-${Date.now()}-${++roomCounter}`;

  test('should render chat UI', async ({ page }) => {
    await page.goto(`/sse-chat?room=${nextRoom()}`);
    await page.waitForSelector('.sse-chat h1');

    await expect(page.locator('h1')).toHaveText('SSE Chat');
    await expect(page.locator('input[type="text"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should send a message and show user bubble', async ({ page }) => {
    await page.goto(`/sse-chat?room=${nextRoom()}`);
    await page.waitForSelector('.sse-chat h1');

    const input = page.locator('input[type="text"]');
    // Use the locator API (auto-waits, resilient to reactive re-renders on the
    // controlled input) and submit via Enter to avoid a click/fill race.
    await input.fill('Hello SSE!');
    // Ensure the controlled input has fully settled before submitting — a
    // re-render can otherwise reset .value from a stale bound state.
    await expect(input).toHaveValue('Hello SSE!');
    await input.press('Enter');

    // User message should appear
    await expect(page.locator('.msg.user .bubble').last()).toContainText('Hello SSE!');
    // Input should be cleared
    await expect(input).toHaveValue('');
  });

  test('should stream bot response via SSE', async ({ page }) => {
    await page.goto(`/sse-chat?room=${nextRoom()}`);
    await page.waitForSelector('.sse-chat h1');

    const input = page.locator('input[type="text"]');
    await input.fill('Hello');
    await expect(input).toHaveValue('Hello');
    await input.press('Enter');

    // Streaming indicator should appear (blinking cursor)
    await expect(page.locator('.msg.assistant.streaming')).toBeVisible({ timeout: 5000 });

    // Wait for streaming to complete (5 sentences × 200ms + margin)
    await expect(page.locator('.msg.assistant.streaming')).toBeHidden({ timeout: 15000 });

    // Final assistant message should be visible as a complete bubble
    const assistantMessages = page.locator('.msg.assistant:not(.streaming) .bubble');
    await expect(assistantMessages).toHaveCount(1);

    const text = await assistantMessages.first().textContent();
    expect(text).toContain('Cossack SSE chat demo');
    expect(text).toContain('real time');
  });

  test('should disable input while streaming', async ({ page }) => {
    await page.goto(`/sse-chat?room=${nextRoom()}`);
    await page.waitForSelector('.sse-chat h1');

    const input = page.locator('input[type="text"]');
    await input.fill('Hello');
    await expect(input).toHaveValue('Hello');
    await input.press('Enter');

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
