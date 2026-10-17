// Plugin recipes in a generated application: a plugin packed by `npm pack` renders into
// src/plugins/<name>/ and passes template checks, type checks, SSR, hydration, RPC and
// client stripping; an upgrade with a locally edited file reports a conflict.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, cossack, productionServer, project, trackRoot, typecheck, vite } from './fixtures/generated-app.js';
import { packPlugin, SERVER_MARKER } from './fixtures/plugin-package.js';

afterEach(cleanupRoots);

async function clientSources(directory) {
  let text = '';
  for (const entry of await fs.readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) text += await fs.readFile(path.join(entry.parentPath, entry.name), 'utf8');
  }
  return text;
}

it('renders a packed plugin and serves its pages, translations, configuration and middleware', async () => {
  const root = await project('node');
  const v1 = await packPlugin('1.0.0');
  const v2 = await packPlugin('1.1.0');
  trackRoot(v1.directory);
  trackRoot(v2.directory);
  await fs.mkdir(path.join(root, 'src/lang'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/lang/en.json'), '{}\n');

  const added = JSON.parse((await cossack(root, ['add', 'plugin', v1.tarball, '--json'])).stdout);
  expect(added).toMatchObject({ ok: true, command: 'add', data: { name: 'support-desk', status: 'added', version: '1.0.0', package: '@acme/support-desk' } });
  expect(JSON.parse(await fs.readFile(path.join(root, 'src/plugins/support-desk/plugin.json'), 'utf8')))
    .toMatchObject({ name: 'support-desk', version: '1.0.0', package: '@acme/support-desk' });
  await expect(fs.access('/tmp/support-desk-ran')).rejects.toThrow();

  const listed = JSON.parse((await cossack(root, ['plugins', 'list', '--json'])).stdout);
  expect(listed.data.rendered).toEqual([expect.objectContaining({ name: 'support-desk', version: '1.0.0', source: { type: 'tarball', spec: v1.tarball } })]);

  const templates = JSON.parse((await cossack(root, ['check', 'templates', '--json'])).stdout);
  expect(templates.data.files).toBeGreaterThan(0);
  expect(templates.data).toMatchObject({ errors: 0, warnings: 0 });
  // Plugin configuration joins the typed config registry ('support-desk::desk').
  await cossack(root, ['config', '--generate']);
  await typecheck(root, 'plugin application');

  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const client = await clientSources(path.join(root, 'dist/client'));
  expect(client).not.toContain(SERVER_MARKER);
  expect(client).not.toContain('Hello from plugin configuration');

  const server = await productionServer(root);
  let browser;
  try {
    const response = await fetch(server.origin + '/support');
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(response.headers.get('x-support-desk')).toBe('1.0.0');
    expect(body).toContain('Support desk');
    expect(body).toContain('Hello from plugin configuration');
    expect(body).toContain('support-desk@1.0.0:Ticket desk');
    expect(body).toContain('Tickets: 0');

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.origin + '/support');
    await page.waitForFunction(() => window.__desk);
    await page.getByRole('button', { name: 'Open ticket' }).click();
    await browserExpect(page.getByTestId('badge')).toHaveText('Tickets: 1');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
  }

  // Upgrade: an edited file that upstream also changes is a conflict and nothing is written.
  const pageFile = path.join(root, 'src/plugins/support-desk/pages/support/index.ts');
  const original = await fs.readFile(pageFile, 'utf8');
  await fs.writeFile(pageFile, original.replace('Open ticket', 'Open a ticket'));
  const conflict = await cossack(root, ['plugins', 'upgrade', 'support-desk', '--source', v2.tarball, '--json']).catch(error => error);
  const envelope = JSON.parse(conflict.stdout);
  expect(envelope).toMatchObject({ ok: false, data: { conflicts: ['src/plugins/support-desk/pages/support/index.ts'] } });
  expect(envelope.diagnostics[0].code).toBe('COSSACK_PLUGIN_CONFLICT');
  expect(await fs.readFile(pageFile, 'utf8')).toContain('Open a ticket');
  expect(await fs.readFile(path.join(root, 'src/plugins/support-desk/middlewares.ts'), 'utf8')).toContain("'1.0.0'");

  await fs.writeFile(pageFile, original);
  const upgraded = JSON.parse((await cossack(root, ['plugins', 'upgrade', 'support-desk', '--source', v2.tarball, '--json'])).stdout);
  expect(upgraded.data).toMatchObject({ status: 'upgraded', from: '1.0.0', version: '1.1.0' });
  expect(await fs.readFile(pageFile, 'utf8')).toContain('v1.1.0');
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const next = await productionServer(root);
  try {
    const response = await fetch(next.origin + '/support');
    expect(response.headers.get('x-support-desk')).toBe('1.1.0');
    expect(await response.text()).toContain('support-desk@1.1.0');
  } finally { await next.close(); }

  const removed = JSON.parse((await cossack(root, ['plugins', 'remove', 'support-desk', '--json'])).stdout);
  expect(removed.data.status).toBe('removed');
  await expect(fs.access(path.join(root, 'src/plugins/support-desk'))).rejects.toThrow();
}, 240_000);

it('fails the build when a plugin page collides with an application page', async () => {
  const root = await project('node');
  const plugin = await packPlugin('1.0.0');
  trackRoot(plugin.directory);
  await cossack(root, ['add', 'plugin', plugin.tarball, '--json']);
  await fs.mkdir(path.join(root, 'src/pages/support'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/support/index.ts'), "import { Cossack, Page } from '@cossackframework/core';\n@Page() export default class Mine extends Cossack {}\n");
  await expect(vite(root, [])).rejects.toThrow(/COSSACK_PLUGIN_ROUTE_CONFLICT[^\n]*src\/plugins\/support-desk\/pages\/support\/index\.ts/);
}, 120_000);
