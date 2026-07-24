import { createClient } from '@libsql/client';
import { createDatabase } from '@cossackframework/database';
import { expect, test } from '@playwright/test';
import { runStudio } from '../dist/index.js';
import { createLocalConnection } from '../src/testing';

let launchUrl = '';
let abort: AbortController;
let running: Promise<void>;

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
      age INTEGER
    )
  `);
  await connection.execute('CREATE TABLE notes (body TEXT)');
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

  await page.getByTestId('object-people').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(50);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('grid-row')).toHaveCount(5);

  await page.getByTestId('tab-structure').click();
  await expect(page.getByTestId('structure-table')).toContainText('PK 1 auto');

  await page.getByTestId('tab-sql').click();
  await page.getByTestId('sql-editor').fill('SELECT COUNT(*) AS total FROM people;');
  await page.getByTestId('run-sql').click();
  await expect(page.getByTestId('sql-results')).toContainText('55');

  await page.getByTestId('sql-editor').fill(
    'CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);',
  );
  await page.getByTestId('sql-editor').press('Control+Enter');
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

  page.once('dialog', async (dialog) => dialog.accept('Edited person'));
  await page.getByTestId('grid-row').first().locator('td').nth(1).dblclick();
  await expect(page.getByTestId('data-grid')).toContainText('Edited person');

  page.once('dialog', async (dialog) => dialog.accept());
  await page.getByTestId('grid-row').first().getByRole('button', { name: 'Delete row' }).click();
  await expect(page.getByTestId('data-grid')).not.toContainText('Edited person');

  await page.getByTestId('object-notes').click();
  await expect(page.getByText('This table has no declared primary key.')).toBeVisible();
  await expect(page.getByTestId('insert-row')).toHaveCount(0);
});
