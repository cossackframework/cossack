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
      nickname VARCHAR(80),
      age INTEGER,
      profile JSON,
      created_at DATETIME
    )
  `);
  await connection.execute('CREATE UNIQUE INDEX people_nickname_idx ON people (nickname)');
  await connection.execute('CREATE TABLE notes (body TEXT)');
  await connection.execute('CREATE TABLE kysely_migration (name TEXT PRIMARY KEY)');
  await connection.execute('CREATE TABLE kysely_migration_lock (id INTEGER PRIMARY KEY)');
  for (let index = 1; index <= 55; index++) {
    await connection.execute(
      'INSERT INTO people (name, nickname, age, created_at) VALUES (?, ?, ?, ?)',
      [`Person ${index}`, `p${index}`, index, `2026-01-${String((index % 28) + 1).padStart(2, '0')} 12:00:00`],
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
  await expect(page).toHaveTitle('Cossack Studio');

  await expect(page.getByTestId('object-kysely_migration')).toHaveCount(0);
  await page.getByRole('button', { name: /System tables/ }).click();
  await page.getByLabel('kysely_migration', { exact: true }).check();
  await expect(page.getByTestId('object-kysely_migration')).toBeVisible();

  const rootWasDark = await page.locator('html').evaluate((element) => element.classList.contains('dark'));
  await page.getByTestId('theme-toggle').click();
  await expect.poll(() => page.locator('html').evaluate((element) =>
    element.classList.contains('dark'))).toBe(!rootWasDark);

  await page.getByTestId('open-command-palette').click();
  const commandPalette = page.getByTestId('studio-command-palette');
  await expect(commandPalette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(commandPalette).toBeHidden();
  await page.keyboard.press('Control+k');
  await expect(commandPalette).toBeVisible();
  await commandPalette.getByPlaceholder('Search tables and views…').fill('people');
  await commandPalette.getByPlaceholder('Search tables and views…').press('Enter');
  await expect(page).toHaveURL(/table=people/);
  await expect(page.getByTestId('rows-empty')).toBeHidden();
  await expect(page.getByTestId('grid-row')).toHaveCount(55);
  await expect(page.getByTestId('rows-loading')).toBeHidden();
  await expect(page.getByTestId('row-count')).toContainText('55 rows');
  await expect(page.getByTestId('page-size')).toHaveValue('100');
  await expect(page.getByTestId('browse-query').locator('.view-lines'))
    .toContainText('SELECT * FROM "people"');
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByTestId('filter-column').selectOption('name');
  await page.getByPlaceholder('Filter value').fill('Person 1');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('grid-row')).toHaveCount(11);
  await expect(page.getByTestId('browse-query').locator('.view-lines')).toContainText('WHERE');
  await page.getByTitle('Remove filter').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(55);
  await page.getByTestId('refresh-rows').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(55);
  await page.getByTestId('page-size').selectOption('50');
  await expect(page.getByTestId('grid-row')).toHaveCount(50);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('grid-row')).toHaveCount(5);

  await page.getByTestId('tab-structure').click();
  await expect(page).toHaveURL(/tab=structure/);
  await expect(page.getByTestId('structure-table')).toContainText('PK 1 · auto');
  await expect(page.getByTestId('index-table')).toContainText('people_nickname_idx');
  await expect(page.getByTestId('structure-sql').locator('.monaco-editor')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('tab-structure')).toBeVisible();
  await expect(page.getByTestId('structure-table')).toContainText('nickname');

  await page.getByTestId('tab-sql').click();
  await replaceEditorValue(page, 'sql-editor', 'SELECT * FROM pe');
  await page.getByTestId('sql-editor').locator('textarea').focus();
  await page.keyboard.press('Control+Space');
  const suggestions = page.getByTestId('sql-editor').locator('.suggest-widget.visible');
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText('people');
  await page.keyboard.press('Escape');
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
  await expect(insert.getByTestId('insert-field-id').locator('select')).toHaveValue('value');
  await insert.getByTestId('insert-field-id').locator('select').selectOption('value');
  await insert.getByTestId('insert-field-id').locator('input').fill('0');
  await insert.getByTestId('insert-field-name').locator('select').selectOption('value');
  await insert.getByTestId('insert-field-name').locator('input').fill('Inserted person');
  await insert.getByTestId('insert-field-nickname').locator('input').fill('inserted');
  await insert.getByTestId('insert-field-age').locator('input').fill('30');
  await page.getByTestId('submit-insert').click();
  await expect(page.getByTestId('data-grid')).toContainText('Inserted person');

  const insertedRow = page.getByTestId('grid-row').filter({ hasText: 'Inserted person' });
  await insertedRow.locator('td').nth(3).dblclick();
  await page.getByTestId('inline-editor').fill('edited-nickname');
  await page.getByTestId('inline-editor').press('Enter');
  await expect(page.getByTestId('data-grid')).toContainText('edited-nickname');
  await expect(page.getByRole('status')).toContainText('Row updated');

  await page.getByTestId('grid-row').filter({ hasText: 'Inserted person' }).locator('td').nth(2).dblclick();
  const cellSheet = page.getByTestId('cell-editor-sheet');
  await expect(cellSheet).toBeVisible();
  await expect(cellSheet.getByTestId('cell-editor-mode')).toHaveValue('text');
  await expect(cellSheet.getByTestId('long-text-editor')).toBeVisible();
  await cellSheet.getByTestId('cell-editor-mode').selectOption('json');
  await expect(cellSheet.getByTestId('json-editor').locator('.monaco-editor')).toBeVisible();
  await cellSheet.getByTestId('cell-editor-mode').selectOption('text');
  await expect(cellSheet.getByTestId('long-text-editor')).toBeVisible();
  await cellSheet.getByRole('button', { name: 'Close' }).click();
  await expect(cellSheet).toBeHidden();

  await page.getByTestId('grid-row').first().locator('td').nth(5).dblclick();
  await expect(cellSheet.getByTestId('json-editor').locator('.monaco-editor')).toBeVisible();
  await cellSheet.getByRole('button', { name: 'Close' }).click();
  await expect(cellSheet).toBeHidden();

  await page.getByTestId('grid-row').filter({ hasText: 'Person 1' }).first().locator('td').nth(6).dblclick();
  await expect(cellSheet.locator('input[type="datetime-local"]')).toHaveValue(/2026-/);
  await cellSheet.getByRole('button', { name: 'Close' }).click();
  await expect(cellSheet).toBeHidden();

  await page.getByTestId('grid-row').first().locator('td').nth(1).dblclick();
  await page.getByTestId('inline-editor').fill('-1');
  await page.getByTestId('inline-editor').press('Enter');
  await expect(page.getByTestId('grid-row').first().locator('td').nth(1)).toContainText('-1');

  await page.getByTestId('grid-row').first().getByRole('button', { name: 'Export row' }).click();
  const exportSheet = page.getByTestId('export-sheet');
  await expect(exportSheet).toBeVisible();
  await exportSheet.locator('select').selectOption('csv');
  await exportSheet.getByRole('button', { name: 'Cancel' }).click();

  const selectionRows = page.getByTestId('grid-row');
  await selectionRows.nth(0).getByLabel('Select row 1').check();
  await selectionRows.nth(1).getByLabel('Select row 2').check();
  await page.getByRole('button', { name: 'Update selected' }).click();
  const batchSheet = page.getByTestId('batch-update-sheet');
  await batchSheet.locator('select').selectOption('age');
  await batchSheet.locator('textarea').fill('999');
  await batchSheet.getByRole('button', { name: 'Update selected' }).click();
  await expect(page.getByTestId('data-grid')).toContainText('999');
  await expect(page.getByRole('status')).toContainText('2 rows updated');
  await expect(page.getByTestId('rows-loading')).toBeHidden();

  await page.getByTestId('grid-row').filter({ hasText: 'Inserted person' })
    .getByRole('button', { name: 'Delete row' }).click();
  const deleteDialog = page.locator('dialog.cs-alert-dialog');
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('data-grid')).not.toContainText('Inserted person');

  await page.getByTestId('object-people').click();
  await page.getByTestId('object-search').fill('notes');
  await page.getByTestId('object-search').press('ArrowDown');
  await page.getByTestId('object-search').press('Enter');
  await expect(page).toHaveURL(/table=notes/);

  await expect(page.getByText('This table has no declared primary key.')).toBeVisible();
  await expect(page.getByTestId('insert-row')).toHaveCount(0);
});
