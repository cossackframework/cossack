import { test, expect } from '@playwright/test';
import { getState, waitForHydration } from '../fixtures/helpers';

test.describe('State Synchronization', () => {
  test.describe('Initial Hydration', () => {
    test('should serialize @State into __INITIAL_STATE__ for hydration', async ({ page }) => {
      await page.goto('/counter-http');

      const state = await getState(page);
      expect(state.public).toEqual({ count: 0 });
      expect(state.transport).toBe('http');
      expect(state.pathname).toBe('/counter-http');
    });

    test('should render initial state values in SSR HTML', async ({ request }) => {
      const html = await (await request.get('/counter-http')).text();
      expect(html).toMatch(/Count:\s*(<!--[^>]*-->)*\s*0/);
    });
  });

  test.describe('HTTP Transport', () => {
    test('should update state via HTTP call', async ({ page }) => {
      await page.goto('/counter-http');
      // SSR text is visible before listeners attach; a click before hydration is lost.
      await waitForHydration(page);

      const count = page.getByText(/^Count: -?\d+$/);
      await expect(count).toHaveText('Count: 0');
      await page.getByRole('button', { name: 'Increment', exact: true }).click();
      await expect(count).toHaveText('Count: 1');
    });
  });

  test.describe('Route params', () => {
    test('should handle dynamic route state', async ({ page }) => {
      await page.goto('/hello/TestUser');

      await expect(page.locator('body')).toContainText('TestUser');
    });
  });

  test.describe('Client State', () => {
    test('should keep @ClientState out of the server payload and reset it on reload', async ({ page }) => {
      await page.goto('/events');
      await waitForHydration(page);

      // @ClientState properties are never serialized by the server.
      const state = await getState(page);
      expect(state.public).toEqual({});

      const clicks = page.getByRole('heading', { name: "@On('click')", exact: true }).locator('..').locator('strong');
      await expect(clicks).toHaveText('0');
      await page.getByRole('heading', { name: 'Event Syntax Demo', exact: true }).click();
      await expect(clicks).toHaveText('1');

      await page.reload();
      await waitForHydration(page);
      await expect(clicks).toHaveText('0');
    });
  });
});
