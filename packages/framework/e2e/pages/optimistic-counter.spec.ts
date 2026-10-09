import { test, expect, type Page } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

type Frame = Record<string, unknown>;

/**
 * Opens the page with WebSocket frame recording, then waits for hydration and
 * the initial Durable Object state-update so the count is settled.
 */
async function openCounter(page: Page) {
  const sent: Frame[] = [];
  const received: Frame[] = [];
  page.on('websocket', socket => {
    if (!new URL(socket.url()).pathname.startsWith('/ws/')) return;
    const record = (target: Frame[], payload: string | Buffer) => {
      try { target.push(JSON.parse(String(payload))); } catch { /* ping/pong */ }
    };
    socket.on('framesent', frame => record(sent, frame.payload));
    socket.on('framereceived', frame => record(received, frame.payload));
  });
  await page.goto('/optimistic-counter');
  await waitForHydration(page);
  await expect.poll(() => received.some(frame => frame.type === 'state-update')).toBe(true);
  const count = page.getByText(/^\s*Count: \d+\s*$/).first();
  const readCount = async () => Number((await count.textContent())!.replace('Count:', '').trim());
  const done = (action: Frame) => received.some(frame => frame.requestId === action.requestId && frame.type === 'done');
  const actions = () => sent.filter(frame => frame.type === 'action' && frame.action === 'increment');
  return { sent, received, count, readCount, done, actions };
}

test.describe('Optimistic Counter Page', () => {
  // The counter lives in one shared Durable Object, so tests elsewhere may
  // increment it concurrently: assert lower bounds, not exact values.

  test('routes upgrade handshakes to the Durable Object and completes a correlated server action', async ({ page }) => {
    const { received, actions, done } = await openCounter(page);
    await page.getByRole('button', { name: 'Increment (+1)', exact: true }).click();
    await expect.poll(() => actions().length).toBe(1);
    const action = actions()[0];
    expect(action.requestId).toEqual(expect.any(String));
    expect(action.payload).toEqual([]);
    await expect.poll(() => done(action), { timeout: 10_000 }).toBe(true);
    expect(received.filter(frame => frame.requestId === action.requestId && frame.type === 'error')).toEqual([]);
  });

  test('should display the counter value', async ({ page }) => {
    await openCounter(page);
    await expect(page).toHaveTitle(/Optimistic Counter/);
    await expect(page.getByText(/^\s*Count: \d+\s*$/)).toHaveCount(1);
  });

  test('should increment counter optimistically, before the server acknowledges', async ({ page }) => {
    const { readCount, actions, done } = await openCounter(page);
    const initialValue = await readCount();

    await page.getByRole('button', { name: 'Increment (+1)', exact: true }).click();
    // increment() sleeps 1s on the server; the optimistic value renders first.
    await expect.poll(readCount).toBeGreaterThanOrEqual(initialValue + 1);
    await expect.poll(() => actions().length).toBe(1);
    expect(done(actions()[0])).toBe(false);

    await expect.poll(() => done(actions()[0]), { timeout: 10_000 }).toBe(true);
    expect(await readCount()).toBeGreaterThanOrEqual(initialValue + 1);
  });

  test('should toggle details panel', async ({ page }) => {
    await openCounter(page);
    const details = page.getByRole('heading', { name: 'Debug Information', exact: true });
    await expect(details).not.toBeVisible();
    await page.getByRole('button', { name: 'Show Info', exact: true }).click();
    await expect(details).toBeVisible();
    await page.getByRole('button', { name: 'Hide Info', exact: true }).click();
    await expect(details).not.toBeVisible();
  });

  test('should handle rapid clicks without losing increments', async ({ page }) => {
    const { readCount, actions, done } = await openCounter(page);
    const initialValue = await readCount();
    const button = page.getByRole('button', { name: 'Increment (+1)', exact: true });

    for (let i = 0; i < 5; i++) await button.click();

    await expect.poll(() => actions().length).toBe(5);
    await expect.poll(() => actions().every(done), { timeout: 15_000 }).toBe(true);
    // Every server increment landed (plus any concurrent ones from other tests).
    await expect.poll(readCount).toBeGreaterThanOrEqual(initialValue + 5);
  });
});
