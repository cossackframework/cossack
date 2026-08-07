import 'reflect-metadata';
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  createORM,
} from '@cossackframework/database';
import { nodeSQLite } from '@cossackframework/database/node';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runStudio } from '../dist/index.js';
import { createLocalConnection } from '../src/testing';

let launchUrl = '';
let abort: AbortController;
let running: Promise<void>;

class Department extends BaseEntity {}
PrimaryColumn({ type: 'integer' })(Department.prototype, 'id');
Column('text')(Department.prototype, 'name');
OneToMany(() => Person, (person: any) => person.department)(Department.prototype, 'people');
Entity({ tableName: 'departments' })(Department);

class Person extends BaseEntity {}
PrimaryColumn({ type: 'integer' })(Person.prototype, 'id');
Column('text')(Person.prototype, 'name');
Column({ type: 'varchar', nullable: true, length: 80 })(Person.prototype, 'nickname');
Column({ type: 'integer', nullable: true })(Person.prototype, 'age');
Column({ type: 'json', nullable: true })(Person.prototype, 'profile');
CreateDateColumn({ name: 'created_at' })(Person.prototype, 'createdAt');
Column({ type: 'integer', name: 'department_id' })(Person.prototype, 'departmentId');
ManyToOne(() => Department, (department: any) => department.people)(
  Person.prototype,
  'department',
);
JoinColumn({ name: 'department_id', referencedColumnName: 'id' })(
  Person.prototype,
  'department',
);
Entity({ tableName: 'people' })(Person);

async function replaceEditorValue(page: Page, testId: string, value: string) {
  const editor = page.getByTestId(testId);
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await editor.locator('textarea').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(value);
}

test.beforeAll(async () => {
  const orm = createORM({
    adapter: await nodeSQLite({ filename: ':memory:' }),
    entities: [Department, Person],
  });
  const connection = createLocalConnection({
    orm,
    info: { provider: 'sqlite', label: 'E2E fixture' },
  });
  await connection.execute('CREATE TABLE departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  await connection.execute(
    'INSERT INTO departments (id, name) VALUES (1, ?), (2, ?)',
    ['Engineering', 'Operations'],
  );
  await connection.execute(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nickname VARCHAR(80),
      age INTEGER,
      profile TEXT,
      created_at VARCHAR(32) NOT NULL,
      department_id INTEGER REFERENCES departments(id)
    )
  `);
  await connection.execute('CREATE UNIQUE INDEX people_nickname_idx ON people (nickname)');
  await connection.execute('CREATE TABLE notes (body TEXT)');
  await connection.execute('CREATE TABLE legacy_users (id TEXT PRIMARY KEY, name VARCHAR(80))');
  await connection.execute(
    'INSERT INTO legacy_users (id, name) VALUES (NULL, ?), (NULL, ?)',
    ['Repair me', 'Delete me'],
  );
  await connection.execute('CREATE TABLE _cossack_migrations (name TEXT PRIMARY KEY)');
  for (let index = 1; index <= 55; index++) {
    await connection.execute(
      'INSERT INTO people (name, nickname, age, created_at, department_id) VALUES (?, ?, ?, ?, ?)',
      [
        `Person ${index}`,
        `p${index}`,
        index,
        `2026-01-${String((index % 28) + 1).padStart(2, '0')} 12:00:00`,
        1,
      ],
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
  const faviconUrl = new URL('/logo.svg', launchUrl).href;
  const faviconResponse = await page.request.get(faviconUrl);
  expect(faviconResponse.status()).toBe(200);
  expect(faviconResponse.headers()['content-type']).toBe('image/svg+xml');

  await page.goto(launchUrl);
  const studioBrand = page.getByTestId('studio-brand');
  await expect(studioBrand.getByRole('img', { name: 'Cossack' })).toBeVisible();
  await expect(studioBrand).toContainText('Studio');
  await expect(page).toHaveTitle('Cossack Studio');
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', '/logo.svg');
  await expect(page.getByTestId('studio-version')).toContainText(/Studio v\d+\.\d+\.\d+/);
  await expect(page.getByTestId('database-version')).toContainText(/SQLite \d+/);

  await expect(page.getByTestId('object-_cossack_migrations')).toHaveCount(0);

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
  await expect(page.getByTestId('relation-column-department')).toContainText('Department');
  await expect(page.getByTestId('relation-column-department')).toContainText('∞-1');
  await page.getByTestId('relation-department-0').click();
  await expect(page).toHaveURL(/table=people/);
  await expect(page.getByTestId('relation-department-0')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('relation-panel-0')).toBeVisible();
  await expect(page.getByTestId('relation-table-0')).toContainText('Engineering');
  await expect(page.getByTestId('relation-row-0')).toHaveCount(1);
  await page.getByTestId('relation-department-0').click();
  await expect(page.getByTestId('relation-panel-0')).toHaveCount(0);
  await page.getByTestId('object-departments').click();
  await expect(page.getByTestId('relation-column-people')).toContainText('Person');
  await expect(page.getByTestId('relation-column-people')).toContainText('1-∞');
  await page.getByTestId('relation-people-0').click();
  await expect(page).toHaveURL(/table=departments/);
  await expect(page.getByTestId('relation-panel-0')).toContainText('55 related rows');
  await expect(page.getByTestId('relation-panel-0')).toContainText('showing first 50');
  await expect(page.getByTestId('relation-row-0')).toHaveCount(50);
  const relatedTabPromise = page.context().waitForEvent('page');
  await page.getByRole('button', { name: 'Open Person relation in a new tab' }).click();
  const relatedTab = await relatedTabPromise;
  await relatedTab.waitForLoadState('domcontentloaded');
  await expect(relatedTab).toHaveURL(/table=people/);
  await expect(relatedTab).toHaveURL(/filter=/);
  await expect(relatedTab.getByTestId('grid-row')).toHaveCount(55);
  await relatedTab.close();
  await page.getByTestId('object-people').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(55);
  await page.getByTestId('tab-structure').click();
  await expect(page.getByTestId('column-type-created_at')).toContainText('datetime');
  await expect(page.getByTestId('column-type-created_at')).toContainText('DB: VARCHAR(32)');
  await expect(page.getByTestId('column-type-profile')).toContainText('json');
  await expect(page.getByTestId('relation-table')).toContainText('department');
  await expect(page.getByTestId('relation-table')).toContainText('∞-1');
  await page.getByTestId('tab-browse').click();
  await page.getByTestId('foreign-key-department_id-0').click();
  await expect(page).toHaveURL(/table=departments/);
  await expect(page).toHaveURL(/filter=/);
  await expect(page.getByTestId('data-grid')).toContainText('Engineering');
  await page.getByTestId('object-people').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(55);
  await expect(page.getByTestId('browse-query').locator('.view-lines'))
    .toContainText('SELECT * FROM "people"');
  await expect(page.getByTestId('browse-query').locator('.view-lines'))
    .not.toContainText('__cossack_rowid__');
  await expect(
    page.getByTestId('browse-toolbar').getByTestId('run-browse-query'),
  ).toBeVisible();
  await expect(
    page.getByTestId('browse-query').getByTestId('run-browse-query'),
  ).toHaveCount(0);
  await replaceEditorValue(page, 'browse-query', 'SEL');
  await page.getByTestId('browse-query').locator('textarea').focus();
  await page.keyboard.press('Control+Space');
  const browseSuggestions = page.getByTestId('browse-query').locator('.suggest-widget.visible');
  await expect(browseSuggestions).toBeVisible();
  await expect(browseSuggestions).toContainText('SELECT');
  await page.keyboard.press('Escape');
  await replaceEditorValue(
    page,
    'browse-query',
    'SELECT id, name FROM people WHERE id = 7',
  );
  await page.getByTestId('run-browse-query').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(1);
  await expect(page.getByTestId('data-grid')).toContainText('Person 7');
  await expect(page.getByText('Custom query · read-only results · Refresh to reset')).toBeVisible();
  await page.getByTestId('grid-row').getByText('Person 7').dblclick();
  await expect(page.getByTestId('inline-editor')).toHaveCount(0);
  await page.getByTestId('refresh-rows').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(55);
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
  await expect(page.getByTestId('foreign-key-table')).toContainText('departments');
  await expect(page.getByTestId('structure-sql').locator('.monaco-editor')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('tab-structure')).toBeVisible();
  await expect(page.getByTestId('structure-table')).toContainText('nickname');

  await page.getByTestId('tab-sql').click();
  await replaceEditorValue(page, 'sql-editor', 'SEL');
  await page.getByTestId('sql-editor').locator('textarea').focus();
  await page.keyboard.press('Control+Space');
  const keywordSuggestions = page.getByTestId('sql-editor').locator('.suggest-widget.visible');
  await expect(keywordSuggestions).toBeVisible();
  await expect(keywordSuggestions).toContainText('SELECT');
  await page.keyboard.press('Escape');
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
  await page.getByTestId('explain-sql').click();
  await expect(page.getByTestId('explain-results')).toContainText(/SCAN|SEARCH/);
  await expect(page.getByTestId('explain-results')).toContainText('people');
  await page.getByTestId('sql-output-results').click();
  await expect(page.getByTestId('sql-results')).toContainText('55');

  await page.getByTestId('open-query-history').click();
  const queryHistory = page.getByTestId('query-history');
  await expect(queryHistory).toBeVisible();
  const countHistory = queryHistory.getByTestId('query-history-entry')
    .filter({ hasText: 'SELECT COUNT(*) AS total FROM people;' })
    .first();
  await expect(countHistory).toBeVisible();
  await countHistory.getByRole('button', { name: 'Save query' }).click();
  await expect(countHistory.getByRole('button', { name: 'Remove from saved queries' }))
    .toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByTestId('open-query-history').click();
  await expect(
    page.getByTestId('query-history').getByRole('button', {
      name: 'Remove from saved queries',
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await replaceEditorValue(
    page,
    'sql-editor',
    'CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);',
  );
  await page.getByTestId('run-sql').click();
  await expect(page.getByTestId('object-projects')).toBeVisible();

  await page.getByTestId('tab-pragmas').click();
  await expect(page).toHaveURL(/tab=pragmas/);
  await expect(page.getByTestId('pragmas-table')).toBeVisible();
  const foreignKeys = page.getByTestId('pragma-foreign_keys');
  await expect(foreignKeys.getByLabel('foreign_keys value')).toHaveAttribute('type', 'checkbox');
  await expect(foreignKeys.locator('select')).toHaveCount(0);
  const userVersion = page.getByTestId('pragma-user_version');
  await userVersion.getByLabel('user_version value').fill('42');
  await userVersion.getByTestId('apply-pragma-user_version').click();
  await expect(page.getByRole('status')).toContainText('PRAGMA user_version updated');
  await expect(page.getByTestId('success-message-icon')).toBeVisible();
  await expect(userVersion.getByLabel('user_version value')).toHaveValue('42');
  await page.reload();
  await expect(page.getByTestId('pragmas-table')).toBeVisible();
  await expect(page.getByTestId('pragma-user_version').getByLabel('user_version value'))
    .toHaveValue('42');

  await page.getByTestId('object-people').click();
  if (await page.locator('html').evaluate((element) => element.classList.contains('dark'))) {
    await page.getByTestId('theme-toggle').click();
  }
  await expect.poll(() => page.locator('html').evaluate((element) =>
    element.classList.contains('dark'))).toBe(false);
  await page.getByTestId('insert-row').click();
  const insert = page.getByTestId('insert-form');
  await expect(insert).toBeVisible();
  await expect(insert.getByTestId('insert-field-id').locator('select')).toHaveCount(1);
  await expect(insert.getByTestId('insert-option-id')).toHaveValue('number');
  await expect(insert.getByTestId('insert-option-id').locator('optgroup')).toHaveCount(2);
  await expect(insert.getByTestId('insert-option-id').locator('option[value="value"]'))
    .toHaveCount(0);
  await expect(insert.getByTestId('insert-option-id').locator('option[value="null"]'))
    .toHaveCount(0);
  await expect(insert.getByTestId('insert-option-age').locator('option[value="null"]'))
    .toHaveCount(1);
  await expect(insert.getByTestId('insert-option-profile')).toHaveValue('json');
  await expect(insert.getByTestId('insert-value-profile').locator('.monaco-editor')).toBeVisible();
  await expect(insert.getByTestId('insert-option-created_at')).toHaveValue('datetime');
  await expect(insert.getByTestId('insert-value-created_at')).not.toHaveValue('');
  await insert.getByTestId('insert-option-name').selectOption('timestamp');
  await expect(insert.getByTestId('insert-value-name')).toHaveValue(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  await expect(insert.getByRole('button', { name: 'Use current server timestamp' }))
    .toBeVisible();
  await insert.getByTestId('insert-option-name').selectOption('text');
  await insert.getByTestId('insert-option-name').selectOption('omit');
  await expect(insert.getByTestId('insert-value-name')).toBeDisabled();
  await insert.getByTestId('insert-option-name').selectOption('json');
  const reactiveJsonEditor = insert.getByTestId('insert-value-name');
  await expect(reactiveJsonEditor.locator('.monaco-editor')).toBeVisible();
  await expect(reactiveJsonEditor.locator('textarea')).toBeEditable();
  await replaceEditorValue(page, 'insert-value-name', '{"reactive":true}');
  await insert.getByTestId('insert-option-name').selectOption('text');
  const activeInsertInput = insert.getByTestId('insert-value-id');
  await expect(activeInsertInput).toHaveClass(/studio-insert-value/);
  const activeInputColors = await activeInsertInput.evaluate((input) => {
    const themeSurface = document.createElement('div');
    themeSurface.style.backgroundColor = 'var(--background)';
    document.body.append(themeSurface);
    const inputStyle = getComputedStyle(input);
    const colors = {
      background: inputStyle.backgroundColor,
      foreground: inputStyle.color,
      matchesTheme: inputStyle.backgroundColor ===
        getComputedStyle(themeSurface).backgroundColor,
    };
    themeSurface.remove();
    return colors;
  });
  expect(activeInputColors.matchesTheme).toBe(false);
  expect(activeInputColors.foreground).not.toBe(activeInputColors.background);
  await insert.getByTestId('insert-option-nickname').selectOption('uuid-v4');
  await expect(insert.getByTestId('insert-value-nickname')).toHaveValue(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await insert.getByTestId('insert-option-nickname').selectOption('text');
  await insert.getByTestId('insert-option-id').selectOption('omit');
  await expect(activeInsertInput).toBeDisabled();
  await insert.getByTestId('insert-value-name').fill('Rejected person');
  await insert.getByTestId('insert-option-nickname').selectOption('omit');
  await insert.getByTestId('insert-option-age').selectOption('omit');
  await insert.getByTestId('insert-option-profile').selectOption('omit');
  await insert.getByTestId('insert-option-created_at').selectOption('omit');
  await insert.getByTestId('insert-option-department_id').selectOption('omit');
  await page.getByTestId('submit-insert').click();
  const insertError = insert.getByTestId('insert-error');
  await expect(insertError).toContainText('NOT NULL constraint failed: people.created_at');
  await expect(insert).toBeVisible();
  await insert.getByTestId('insert-value-name').fill('Corrected person');
  await expect(page.getByTestId('submit-insert')).toBeEnabled();
  await expect(page.getByTestId('data-grid')).not.toContainText('Rejected person');

  await page.reload();
  await page.getByTestId('insert-row').click();
  const retryInsert = page.getByTestId('insert-form');
  await expect(retryInsert).toBeVisible();
  await retryInsert.getByTestId('insert-value-id').fill('0');
  await retryInsert.getByTestId('insert-value-name').fill('Inserted person');
  await retryInsert.getByTestId('insert-value-nickname').fill('inserted');
  await retryInsert.getByTestId('insert-value-age').fill('30');
  await retryInsert.getByTestId('insert-value-created_at').fill('2026-02-01T12:00');
  await retryInsert.getByTestId('insert-option-department_id').selectOption('omit');
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

  await page.getByTestId('grid-row').filter({ hasText: 'Inserted person' })
    .getByRole('button', { name: 'Edit row as JSON' }).click();
  const rowSheet = page.getByTestId('row-editor-sheet');
  await expect(rowSheet).toBeVisible();
  await expect(rowSheet.getByTestId('row-json-editor').locator('.monaco-editor')).toBeVisible();
  await expect(rowSheet.getByTestId('row-json-editor').locator('.view-lines'))
    .toContainText('Inserted person');
  await rowSheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(rowSheet).toBeHidden();

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
  await page.getByRole('button', { name: 'Export selected' }).click();
  await expect(exportSheet).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await exportSheet.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toBe('people-rows.json');
  expect(downloadPath).not.toBeNull();
  expect(JSON.parse(await readFile(downloadPath!, 'utf8'))).toEqual([
    expect.objectContaining({ id: -1 }),
  ]);

  await selectionRows.nth(1).getByLabel('Select row 2').check();
  await page.getByRole('button', { name: 'Update selected' }).click();
  const batchSheet = page.getByTestId('batch-update-sheet');
  await batchSheet.locator('select').selectOption('age');
  await batchSheet.locator('textarea').fill('999');
  await batchSheet.getByRole('button', { name: 'Update selected' }).click();
  await expect(page.getByTestId('data-grid')).toContainText('999');
  await expect(page.getByRole('status')).toContainText('2 rows updated');
  await expect(page.getByTestId('rows-loading')).toBeHidden();

  await page.getByTestId('grid-row').first().getByLabel('Select row 1').check();
  await page.getByRole('button', { name: 'Cancel Selected' }).click();
  await expect(page.getByRole('button', { name: 'Cancel Selected' })).toHaveCount(0);
  await expect(page.getByTestId('grid-row').first().getByLabel('Select row 1')).not.toBeChecked();

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

  await expect(page.getByTestId('insert-row')).toBeVisible();
  await page.getByTestId('insert-row').click();
  const noteInsert = page.getByTestId('insert-form');
  await noteInsert.getByTestId('insert-value-body').fill('rowid-backed');
  await page.getByTestId('submit-insert').click();
  const noteRow = page.getByTestId('grid-row').filter({ hasText: 'rowid-backed' });
  await expect(noteRow).toBeVisible();
  await noteRow.locator('td').nth(1).dblclick();
  await cellSheet.getByTestId('long-text-editor').fill('rowid-updated');
  await cellSheet.getByTestId('save-cell-editor').click();
  await expect(page.getByTestId('data-grid')).toContainText('rowid-updated');

  await page.getByTestId('object-search').fill('');
  await page.getByTestId('object-legacy_users').click();
  const repairRow = page.getByTestId('grid-row').filter({ hasText: 'Repair me' });
  await repairRow.locator('td').nth(1).dblclick();
  await expect(cellSheet.getByTestId('cell-editor-mode')).toHaveValue('null');
  await cellSheet.getByTestId('cell-editor-mode').selectOption('text');
  await expect(cellSheet.getByTestId('long-text-editor')).toBeEnabled();
  await cellSheet.getByTestId('long-text-editor').fill('repaired-id');
  await cellSheet.getByTestId('save-cell-editor').click();
  await expect(page.getByTestId('data-grid')).toContainText('repaired-id');

  await page.getByTestId('grid-row').filter({ hasText: 'Delete me' })
    .getByRole('button', { name: 'Delete row' }).click();
  await deleteDialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('data-grid')).not.toContainText('Delete me');
});
