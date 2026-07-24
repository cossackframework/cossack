import { createClient } from '@libsql/client';
import { createDatabase } from '@cossackframework/database';
import { expect, test, type Page } from '@playwright/test';
import { runStudio } from '../dist/index.js';
import { createLocalConnection } from '../src/testing';

let launchUrl = '';
let abort: AbortController;
let running: Promise<void>;

async function replaceEditorValue(page: Page, testId: string, value: string) {
  const editor = page.getByTestId(testId);
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await editor.locator('textarea').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(value);
}

test.beforeAll(async () => {
  const client = createClient({ url: ':memory:' });
  const connection = createLocalConnection({
    client: createDatabase({ dialect: 'libsql', client }),
    info: { provider: 'sqlite', label: 'E2E fixture' },
  });
  await connection.execute(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      age INTEGER,
      profile JSON
    )
  `);
  await connection.execute('CREATE TABLE notes (body TEXT)');
  await connection.execute('CREATE TABLE kysely_migration (name TEXT PRIMARY KEY)');
  await connection.execute('CREATE TABLE kysely_migration_lock (id INTEGER PRIMARY KEY)');
  for (let index = 1; index <= 55; index++) {
    await connection.execute(
      'INSERT INTO people (name, age) VALUES (?, ?)',
      [`Person ${index}`, index],
    );
  }
  abort = new AbortController();
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    const text = String(message);
    if (text.startsWith('Cossack Studio: ')) launchUrl = text.slice('Cossack Studio: '.length);
    originalLog(message);
  };
  running = runStudio({
    port: 51_984,
    open: false,
    connection,
    signal: abort.signal,
  });
  while (!launchUrl) await new Promise((resolve) => setTimeout(resolve, 10));
  console.log = originalLog;
});

test.afterAll(async () => {
  abort.abort();
  await running;
});

test('browses, queries, mutates, and refreshes SQLite schema', async ({ page }) => {
  await page.goto(launchUrl);
  await expect(page.getByText('Cossack Studio', { exact: true })).toBeVisible();

  await expect(page.getByTestId('object-kysely_migration')).toHaveCount(0);
  await page.getByRole('button', { name: /System tables/ }).click();
  await page.getByLabel('kysely_migration', { exact: true }).check();
  await expect(page.getByTestId('object-kysely_migration')).toBeVisible();

  const rootWasDark = await page.locator('html').evaluate((element) => element.classList.contains('dark'));
  await page.getByTestId('theme-toggle').click();
  await expect.poll(() => page.locator('html').evaluate((element) =>
    element.classList.contains('dark'))).toBe(!rootWasDark);

  await page.getByTestId('object-people').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(55);
  await expect(page.getByTestId('row-count')).toContainText('55 rows');
  await expect(page.getByTestId('page-size')).toHaveValue('100');
  await page.getByTestId('page-size').selectOption('50');
  await expect(page.getByTestId('grid-row')).toHaveCount(50);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('grid-row')).toHaveCount(5);

  await page.getByTestId('tab-structure').click();
  await expect(page.getByTestId('structure-table')).toContainText('PK 1 auto');

  await page.getByTestId('tab-sql').click();
  await replaceEditorValue(page, 'sql-editor', 'SELECT COUNT(*) AS total FROM people;');
  await page.getByTestId('run-sql').click();
  await expect(page.getByTestId('sql-results')).toContainText('55');
  await expect(page.getByTestId('run-sql')).toBeEnabled();

  await replaceEditorValue(
    page,
    'sql-editor',
    'CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);',
  );
  const sqlTextarea = page.getByTestId('sql-editor').locator('textarea');
  await sqlTextarea.focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('object-projects')).toBeVisible();

  await page.getByTestId('object-people').click();
  await page.getByTestId('insert-row').click();
  const insert = page.getByTestId('insert-form');
  await insert.locator('label').filter({ hasText: 'id' }).locator('select').selectOption('value');
  await insert.locator('label').filter({ hasText: 'id' }).locator('input').fill('0');
  await insert.locator('label').filter({ hasText: 'name' }).locator('select').selectOption('value');
  await insert.locator('label').filter({ hasText: 'name' }).locator('input').fill('Inserted person');
  await page.getByTestId('submit-insert').click();
  await expect(page.getByTestId('data-grid')).toContainText('Inserted person');

  await page.getByTestId('grid-row').first().locator('td').nth(1).dblclick();
  await page.getByTestId('inline-editor').fill('Edited person');
  await page.getByTestId('inline-editor').press('Enter');
  await expect(page.getByTestId('data-grid')).toContainText('Edited person');

  await page.getByTestId('grid-row').first().locator('td').nth(3).dblclick();
  const cellSheet = page.getByTestId('cell-editor-sheet');
  await expect(cellSheet).toBeVisible();
  await expect(cellSheet.getByTestId('json-editor').locator('.monaco-editor')).toBeVisible();
  await cellSheet.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('grid-row').first().getByRole('button', { name: 'Delete row' }).click();
  const deleteDialog = page.locator('dialog.cs-alert-dialog');
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Delete row' }).click();
  await expect(page.getByTestId('data-grid')).not.toContainText('Edited person');

  await page.getByTestId('object-notes').click();
  await expect(page.getByText('This table has no declared primary key.')).toBeVisible();
  await expect(page.getByTestId('insert-row')).toHaveCount(0);
});
