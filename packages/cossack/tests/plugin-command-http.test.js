import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { findPluginCommand, runPluginCommand } from '../src/plugin-commands.js';

const roots = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-plugin-command-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'src/plugins/seo'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"app"}');
  await fs.writeFile(path.join(root, 'src/plugins/seo/plugin.json'), JSON.stringify({
    name: 'seo', commands: [{ name: 'reindex', description: 'Rebuild the index.', options: {} }],
  }));
  return root;
}

it('takes --allow-http, like cossack cms commands, for a plain-HTTP development host', async () => {
  const root = await project();
  vi.stubEnv('CMS_EMAIL', 'ada@example.com');
  vi.stubEnv('CMS_PASSWORD', 'long password');
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('COSSACK_CMS_ALLOW_HTTP', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    requests.push(`${init.method} ${url}`);
    if (init.method === 'POST' && String(url).endsWith('/api/auth/session')) return new Response('{}', { status: 200, headers: { 'set-cookie': 'session=1; Path=/' } });
    return new Response(JSON.stringify({ result: 'done' }), { status: 200 });
  }));
  const found = await findPluginCommand('seo:reindex', root);

  // Without the flag, plain HTTP to another machine is refused before anything is sent.
  expect(await runPluginCommand('seo:reindex', ['--url', 'http://myapp.test'], found)).toBe(1);
  expect(requests).toEqual([]);

  // With it, the flag is the CLI's, not refused as an unknown plugin option.
  expect(await runPluginCommand('seo:reindex', ['--url', 'http://myapp.test', '--allow-http'], found)).toBe(0);
  expect(requests).toEqual([
    'POST http://myapp.test/api/auth/session',
    'POST http://myapp.test/api/cms/commands/seo/reindex',
    'DELETE http://myapp.test/api/auth/session',
  ]);
});
