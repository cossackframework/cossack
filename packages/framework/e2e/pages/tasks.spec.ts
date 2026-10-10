import { test, expect, type Page } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

const SEED = ['Learn Cossack Framework', 'Build a real-time app', 'Deploy to Cloudflare Workers'];

function taskItems(page: Page) {
  return page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Delete' }) });
}

test.describe('Tasks Page', () => {
  // All tests share one Durable Object task list and one test deletes from it.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/tasks');
    await waitForHydration(page);
  });

  test('renders the server-initialized task list', async ({ page }) => {
    await expect(page).toHaveTitle(/Task List/);
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
    // The list lives in a shared Durable Object and the delete test removes
    // entries, so assert membership in the seed rather than an exact list.
    const texts = await taskItems(page).locator('span').allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(SEED).toContain(text.trim());
  });

  test('dismissing the confirm dialog does not delete the task', async ({ page }) => {
    const first = taskItems(page).first();
    const text = (await first.locator('span').textContent())!.trim();
    page.once('dialog', dialog => dialog.dismiss());
    await first.getByRole('button', { name: 'Delete' }).click();
    await expect(first.getByRole('button', { name: 'Delete' })).toBeEnabled();
    await expect(taskItems(page).filter({ hasText: text })).toHaveCount(1);
  });

  test('deleting a task updates every tab on the channel', async ({ page, context }) => {
    const other = await context.newPage();
    await other.goto('/tasks');
    await waitForHydration(other);

    const first = taskItems(page).first();
    const text = (await first.locator('span').textContent())!.trim();
    // Deleting the last task empties the list, and the tasks:changed handler's
    // init() then re-seeds it.
    const wasLast = (await taskItems(page).count()) === 1;
    await expect(taskItems(other).filter({ hasText: text })).toHaveCount(1);

    const dialogs: string[] = [];
    page.on('dialog', dialog => {
      dialogs.push(`${dialog.type()}:${dialog.message()}`);
      void dialog.accept();
    });
    other.on('dialog', dialog => void dialog.accept());

    await first.getByRole('button', { name: 'Delete' }).click();
    // The per-task loading flag disables the button while the server works.
    await expect(taskItems(page).filter({ hasText: text }).getByRole('button')).toBeDisabled();

    for (const tab of [page, other]) {
      if (wasLast) await expect(taskItems(tab).locator('span')).toHaveText(SEED, { timeout: 10_000 });
      else await expect(taskItems(tab).filter({ hasText: text })).toHaveCount(0, { timeout: 10_000 });
    }
    await expect.poll(() => dialogs).toEqual([
      'confirm:Are you sure you want to delete this task?',
      'alert:Task was deleted successfully!',
    ]);
    await other.close();
  });
});
