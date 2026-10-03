import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { routesCommand } from '../src/commands/routes.js';
import { discoverRoutes } from '@cossackframework/framework/route-codegen';

const roots = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cli-route-types-')); roots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  const page = path.join(root, 'src/pages/users/[id]/index.ts'); await fs.mkdir(path.dirname(page), { recursive: true });
  await fs.writeFile(page, `import { Cossack, Page } from '@cossackframework/core'; @Page() export default class User extends Cossack {}`);
  return root;
}
it('generates typed URLs from the same manifest it exposes and previews without writes', async () => {
  const root = await project(); const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await routesCommand([], { cwd: root, flags: { generate: true, json: true, 'dry-run': true } })).toBe(0);
  let result = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(result.data.generation).toEqual({ file: '.cossack/routes.ts', changed: true, written: false, dryRun: true });
  await expect(fs.stat(path.join(root, '.cossack/routes.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await routesCommand([], { cwd: root, flags: { generate: true, json: true } })).toBe(0);
  result = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(result.data.generation.written).toBe(true);
  expect(result.data.manifest).toEqual(discoverRoutes(root));
  expect(result.data.routes[0]).toMatchObject({ name: '/users/[id]', route: '/users/:id', params: [{ name: 'id', catchAll: false }] });
  expect(await fs.readFile(path.join(root, '.cossack/routes.ts'), 'utf8')).toContain('"/users/[id]": "/users/:id"');
});
it('keeps inspection read-only and rejects unsupported flags before generation', async () => {
  const root = await project(); const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await routesCommand([], { cwd: root, flags: { json: true } })).toBe(0);
  await expect(fs.stat(path.join(root, '.cossack/routes.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await routesCommand([], { cwd: root, flags: { 'dry-run': true, json: true } })).toBe(1);
  expect(JSON.parse(log.mock.calls.at(-1)[0]).diagnostics[0].code).toBe('COSSACK_OPTION_CONFLICT');
  expect(await routesCommand([], { cwd: root, flags: { generte: true, json: true } })).toBe(1);
  expect(JSON.parse(log.mock.calls.at(-1)[0]).diagnostics[0].code).toBe('COSSACK_OPTION_UNKNOWN');
  await expect(fs.stat(path.join(root, '.cossack/routes.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('includes configured Markdown only when selected and never treats tests as routes', async () => {
  const root = await project(); const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await fs.writeFile(path.join(root, 'src/pages/guide.md'), '# Guide');
  await fs.writeFile(path.join(root, 'src/pages/page.test.ts'), 'throw new Error("never execute");');
  expect(await routesCommand([], { cwd: root, flags: { json: true } })).toBe(0);
  expect(JSON.parse(log.mock.calls.at(-1)[0]).data.routes.map(route => route.name)).toEqual(['/users/[id]']);
  expect(await routesCommand([], { cwd: root, flags: { generate: true, markdown: true, json: true } })).toBe(0);
  expect(JSON.parse(log.mock.calls.at(-1)[0]).data.manifest).toEqual(discoverRoutes(root, true));
  expect(await fs.readFile(path.join(root, '.cossack/routes.ts'), 'utf8')).toContain('"/guide": "/guide"');
});
