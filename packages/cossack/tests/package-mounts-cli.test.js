import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRouteModel } from '../src/scan-routes.js';
import { inspectLocalization } from '../src/localization-service.js';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function project() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cli-mounts-')));
  roots.push(root);
  const files = {
    'package.json': JSON.stringify({ name: 'app', cossack: { packages: ['@acme/kit'] } }),
    'src/pages/index.ts': "export default class Home { render() { return __('Application key'); } }\n",
    'src/lang/en.json': JSON.stringify({ 'Application key': 'Application key' }),
    'node_modules/@acme/kit/package.json': JSON.stringify({ name: '@acme/kit', version: '1.0.0', cossack: { root: 'app/src', pages: ['pages/kit/'] } }),
    'node_modules/@acme/kit/app/src/pages/kit/index.ts': "export default class Kit { render() { return __('Served key'); } }\n",
    'node_modules/@acme/kit/app/src/pages/kit/layout.ts': 'export default class Layout {}\n',
  };
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}

describe('a mounted package in the CLI', () => {
  it('lists served routes with the package that serves them', async () => {
    const model = buildRouteModel(await project());
    expect(model.pages.map(page => [page.route, page.filePath, page.package])).toEqual([
      ['/', '/src/pages/index.ts', undefined],
      ['/kit', '/src/pages/kit/index.ts', '@acme/kit'],
    ]);
    expect(model.layouts).toEqual([expect.objectContaining({ filePath: '/src/pages/kit/layout.ts', package: '@acme/kit' })]);
  });

  it('finds the translation keys of served files', async () => {
    const report = await inspectLocalization(await project());
    expect(report.calls.map(call => call.key).sort()).toEqual(['Application key', 'Served key']);
  });
});
