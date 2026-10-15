// Studio on a real MySQL server. Runs only when COSSACK_TEST_MYSQL_URL is set
// (docs/testing.md), and skips otherwise; with COSSACK_TEST_REQUIRE_LIVE=1
// (`pnpm test:databases`) a missing URL fails instead.
//
// MySQL schema loads defer each object's SHOW CREATE statement, so the
// Structure tab loads the definition of the object it shows.
import { createORM } from '@cossackframework/database';
import { mysql } from '@cossackframework/database/node';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type AddressInfo } from 'node:net';
import { runStudio } from '../dist/index.js';
import { createLocalConnection, type LocalStudioConnection } from '../src/testing';

const url = process.env.COSSACK_TEST_MYSQL_URL;
const DROP = [
  'DROP VIEW IF EXISTS se_open_tickets',
  'DROP TABLE IF EXISTS se_tickets',
];

if (!url && process.env.COSSACK_TEST_REQUIRE_LIVE === '1') {
  throw new Error('COSSACK_TEST_REQUIRE_LIVE=1 requires COSSACK_TEST_MYSQL_URL.');
}
test.skip(!url, 'COSSACK_TEST_MYSQL_URL is not set');

let launchUrl = '';
let abort: AbortController;
let running: Promise<void>;
let connection: LocalStudioConnection;
const showCreate: string[] = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function definition(page: Page) {
  const editor = page.getByTestId('structure-sql');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  return editor.locator('.view-lines');
}

test.beforeAll(async () => {
  connection = createLocalConnection({
    orm: createORM({ adapter: await mysql(url!), entities: [] }),
    info: { provider: 'mysql', label: 'MySQL E2E fixture' },
  });
  for (const statement of DROP) await connection.execute(statement);
  await connection.execute(`
    CREATE TABLE se_tickets (
      id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title varchar(80) NOT NULL,
      status enum('open', 'closed') NOT NULL DEFAULT 'open'
    )
  `);
  await connection.execute(
    'CREATE VIEW se_open_tickets AS SELECT id, title FROM se_tickets WHERE status = \'open\'',
  );
  await connection.execute('INSERT INTO se_tickets (title) VALUES (?), (?)', ['First', 'Second']);
  const execute = connection.execute.bind(connection);
  connection.execute = (sql, parameters) => {
    if (sql.startsWith('SHOW CREATE ')) showCreate.push(sql);
    return execute(sql, parameters);
  };

  abort = new AbortController();
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    const text = String(message);
    if (text.startsWith('Cossack Studio: ')) launchUrl = text.slice('Cossack Studio: '.length);
    originalLog(message);
  };
  running = runStudio({ port: await freePort(), open: false, connection, signal: abort.signal });
  while (!launchUrl) await new Promise((resolve) => setTimeout(resolve, 10));
  console.log = originalLog;
});

test.afterAll(async () => {
  if (!url) return;
  abort.abort();
  await running;
  // runStudio closes the connection; drop the fixture with a fresh one.
  const cleanup = createLocalConnection({
    orm: createORM({ adapter: await mysql(url), entities: [] }),
    info: { provider: 'mysql' },
  });
  try {
    for (const statement of DROP) await cleanup.execute(statement);
  } finally {
    await cleanup.close();
  }
});

test('loads MySQL definitions when the Structure tab shows them', async ({ page }) => {
  await page.goto(launchUrl);
  await page.waitForFunction(() => (window as unknown as { __cossackReady?: boolean }).__cossackReady === true);
  await expect(page.getByTestId('database-version')).toContainText(/MySQL \d+/);
  expect(showCreate).toEqual([]);

  await page.getByTestId('object-se_tickets').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(2);
  expect(showCreate).toEqual([]);

  await page.getByTestId('tab-structure').click();
  await expect(await definition(page)).toContainText('CREATE TABLE');
  await expect(page.getByTestId('structure-sql-loading')).toHaveCount(0);
  expect(showCreate).toEqual(['SHOW CREATE TABLE `se_tickets`']);

  // A reload restores the Structure tab from the URL; the server keeps the definition.
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __cossackReady?: boolean }).__cossackReady === true);
  await expect(await definition(page)).toContainText('se_tickets');
  expect(showCreate).toHaveLength(1);

  await page.getByTestId('object-se_open_tickets').click();
  await page.getByTestId('tab-structure').click();
  await expect(await definition(page)).toContainText('VIEW');
  expect(showCreate).toEqual(['SHOW CREATE TABLE `se_tickets`', 'SHOW CREATE VIEW `se_open_tickets`']);

  // Refreshing the schema drops cached definitions; the Structure tab loads its own again.
  await page.getByTestId('tab-browse').click();
  await page.getByTestId('refresh-rows').click();
  await expect(page.getByTestId('grid-row')).toHaveCount(2);
  await page.getByTestId('tab-structure').click();
  await expect(await definition(page)).toContainText('se_open_tickets');
  expect(showCreate).toHaveLength(3);
});
