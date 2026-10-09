import { test, expect } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

test.describe('Decorators', () => {
  test.describe('@Server Decorator', () => {
    test('should call server method and update state', async ({ page }) => {
      await page.goto('/counter-http');
      await waitForHydration(page);

      const count = page.getByText(/^Count:\s*\d+$/);
      const initialMatch = (await count.textContent())?.match(/Count:\s*(\d+)/);
      const initialValue = initialMatch ? parseInt(initialMatch[1], 10) : 0;

      await page.getByRole('button', { name: 'Increment', exact: true }).click();
      await expect(count).toHaveText(`Count: ${initialValue + 1}`);
    });
  });

  test.describe('@Optimistic Decorator', () => {
    test('should update UI before the server action completes', async ({ page }) => {
      const received: Array<Record<string, unknown>> = [];
      const sent: Array<Record<string, unknown>> = [];
      page.on('websocket', socket => {
        if (!new URL(socket.url()).pathname.startsWith('/ws/')) return;
        const record = (target: Array<Record<string, unknown>>, payload: string | Buffer) => {
          try { target.push(JSON.parse(String(payload))); } catch { /* ping/pong */ }
        };
        socket.on('framesent', frame => record(sent, frame.payload));
        socket.on('framereceived', frame => record(received, frame.payload));
      });
      await page.goto('/optimistic-counter');
      await waitForHydration(page);
      // The initial Durable Object state-update must land before reading the value.
      await expect.poll(() => received.some(frame => frame.type === 'state-update')).toBe(true);

      const count = page.getByText(/^\s*Count: \d+\s*$/).first();
      const readCount = async () => Number((await count.textContent())!.replace('Count:', '').trim());
      const initialValue = await readCount();

      await page.getByRole('button', { name: 'Increment (+1)', exact: true }).click();
      // The server sleeps 1s in increment(); the optimistic handler must render
      // the new value while the action is still unacknowledged.
      await expect.poll(readCount).toBeGreaterThanOrEqual(initialValue + 1);
      const action = sent.find(frame => frame.type === 'action' && frame.action === 'increment');
      expect(action).toBeDefined();
      expect(received.some(frame => frame.requestId === action!.requestId && frame.type === 'done')).toBe(false);

      await expect.poll(() => received.some(frame => frame.requestId === action!.requestId && frame.type === 'done'),
        { timeout: 10_000 }).toBe(true);
      expect(await readCount()).toBeGreaterThanOrEqual(initialValue + 1);
    });
  });

  test.describe('@ClientState Decorator', () => {
    test('should track client-side state changes', async ({ page }) => {
      await page.goto('/events');
      await expect(page.getByRole('heading', { name: "@On('mount')", exact: true })
        .locator('..').locator('strong')).toHaveText('yes');
      const count = page.getByRole('heading', { name: "@On('click')", exact: true })
        .locator('..').locator('strong');
      await expect(count).toHaveText('0');
      await page.getByRole('heading', { name: 'Event Syntax Demo', exact: true }).click();
      await expect(count).toHaveText('1');
    });
  });

  test.describe('@On Event Decorator', () => {
    test('should handle element click events', async ({ page }) => {
      await page.goto('/events');

      await expect(page.getByRole('heading', { name: "@On('mount')", exact: true })
        .locator('..').locator('strong')).toHaveText('yes');
      const count = page.getByRole('heading', { name: "@On('click')", exact: true })
        .locator('..').locator('strong');
      await expect(count).toHaveText('0');
      const containerHeading = page.getByRole('heading', { name: 'Event Syntax Demo', exact: true });
      await containerHeading.click();
      await expect(count).toHaveText('1');
      await containerHeading.click();
      await expect(count).toHaveText('2');
    });

    test('should handle document-level events', async ({ page }) => {
      await page.goto('/events');
      await expect(page.getByRole('heading', { name: "@On('mount')", exact: true })
        .locator('..').locator('strong')).toHaveText('yes');
      const key = page.getByRole('heading', { name: "@OnDocument('keydown')", exact: true })
        .locator('..').locator('strong');
      await expect(key).toHaveText('None');
      await page.keyboard.press('a');
      await expect(key).toHaveText('a');
    });

    test('should handle window events', async ({ page }) => {
      await page.goto('/events');
      await expect(page.getByRole('heading', { name: "@On('mount')", exact: true })
        .locator('..').locator('strong')).toHaveText('yes');
      const size = page.getByRole('heading', { name: "@OnWindow('resize')", exact: true })
        .locator('..').locator('strong');
      const viewportSize = page.viewportSize();
      expect(viewportSize).not.toBeNull();
      await expect(size).toHaveText(`${viewportSize!.width}x${viewportSize!.height}`);
      await page.setViewportSize({ width: viewportSize!.width + 100, height: viewportSize!.height });
      await expect(size).toHaveText(`${viewportSize!.width + 100}x${viewportSize!.height}`);
    });
  });
  // @Ref coverage lives in e2e/pages/refs.spec.ts.
});
