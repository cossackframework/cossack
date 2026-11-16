import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { findPluginCommand, runPluginCommand } from '../src/plugin-commands.js';
import { rememberLogin } from '../src/cms/logins.js';

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
  // Never the developer's own stored logins.
  vi.stubEnv('COSSACK_CONFIG_DIR', path.join(root, '.config'));
  vi.stubEnv('COSSACK_CMS_TOKEN', '');
  vi.stubEnv('COSSACK_CMS_URL', '');
  vi.stubEnv('APP_URL', '');
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

it('runs with the stored application password instead of a password sign-in', async () => {
  const root = await project();
  vi.stubEnv('CMS_EMAIL', '');
  vi.stubEnv('CMS_PASSWORD', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await rememberLogin({ url: 'https://cms.example', token: 'cms_aaaaaaaaaaaaaaaa.secret', tokenId: 'aaaaaaaaaaaaaaaa', name: 'cli', scope: 'write', email: 'ada@example.com', user: 'u1' }, { COSSACK_CONFIG_DIR: path.join(root, '.config') });
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    requests.push(`${init.method} ${url} ${init.headers.authorization ?? ''}`.trim());
    return new Response(JSON.stringify({ result: 'done' }), { status: 200 });
  }));
  const found = await findPluginCommand('seo:reindex', root);
  expect(await runPluginCommand('seo:reindex', ['--url', 'https://cms.example'], found)).toBe(0);
  expect(requests).toEqual(['POST https://cms.example/api/cms/commands/seo/reindex Bearer cms_aaaaaaaaaaaaaaaa.secret']);
});

it('says why a password sign-in was refused: the bot check or required two-step sign-in', async () => {
  const root = await project();
  vi.stubEnv('CMS_EMAIL', 'ada@example.com');
  vi.stubEnv('CMS_PASSWORD', 'long password');
  const errors = [];
  vi.spyOn(console, 'error').mockImplementation((...line) => errors.push(line.join(' ')));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  let answer = { status: 403, body: { error: 'Complete the check.', code: 'CMS_BOT_CHECK' } };
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (init.method === 'POST' && String(url).endsWith('/api/auth/session')) {
      return answer.status === 200 ? new Response('{}', { status: 200, headers: { 'set-cookie': 'session=1; Path=/' } }) : new Response(JSON.stringify(answer.body), { status: answer.status });
    }
    if (init.method === 'POST') return new Response(JSON.stringify({ error: 'Set up two-step sign-in.', code: 'CMS_SECOND_FACTOR_REQUIRED' }), { status: 403 });
    return new Response(null, { status: 204 });
  }));
  const found = await findPluginCommand('seo:reindex', root);
  expect(await runPluginCommand('seo:reindex', ['--url', 'https://cms.example'], found)).toBe(1);
  expect(errors.join('\n')).toMatch(/checks sign-ins for bots.*--token or COSSACK_CMS_TOKEN/s);
  errors.length = 0;
  answer = { status: 200 };
  expect(await runPluginCommand('seo:reindex', ['--url', 'https://cms.example'], found)).toBe(1);
  expect(errors.join('\n')).toMatch(/requires two-step sign-in/);
});

it('sends shell credentials to an APP_URL only when --url or COSSACK_CMS_URL confirms it', async () => {
  const root = await project();
  // A project's .env loaded into the shell (direnv, dotenv --) sets APP_URL there too.
  vi.stubEnv('APP_URL', 'https://elsewhere.example');
  vi.stubEnv('COSSACK_CMS_TOKEN', 'cms_tttttttttttttttt.secret');
  vi.stubEnv('CMS_EMAIL', '');
  vi.stubEnv('CMS_PASSWORD', '');
  const errors = [];
  vi.spyOn(console, 'error').mockImplementation((...line) => errors.push(line.join(' ')));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    requests.push(`${init.method} ${url}`);
    return new Response(JSON.stringify({ result: 'done' }), { status: 200 });
  }));
  const found = await findPluginCommand('seo:reindex', root);
  expect(await runPluginCommand('seo:reindex', [], found)).toBe(1);
  expect(requests).toEqual([]);
  expect(errors.join('\n')).toMatch(/COSSACK_CMS_TOKEN is not sent to https:\/\/elsewhere\.example.*--url/s);
  // A shell CMS_PASSWORD is held back the same way.
  vi.stubEnv('COSSACK_CMS_TOKEN', '');
  vi.stubEnv('CMS_EMAIL', 'ada@example.com');
  vi.stubEnv('CMS_PASSWORD', 'long password');
  expect(await runPluginCommand('seo:reindex', [], found)).toBe(1);
  expect(requests).toEqual([]);
  // COSSACK_CMS_URL confirms an address, and wins over APP_URL.
  vi.stubEnv('CMS_PASSWORD', '');
  vi.stubEnv('COSSACK_CMS_TOKEN', 'cms_tttttttttttttttt.secret');
  vi.stubEnv('COSSACK_CMS_URL', 'https://cms.example');
  expect(await runPluginCommand('seo:reindex', [], found)).toBe(0);
  expect(requests).toEqual(['POST https://cms.example/api/cms/commands/seo/reindex']);
});
