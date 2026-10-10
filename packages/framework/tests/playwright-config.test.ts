import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function load(port?: string, ssg = '', server = '', reuse = '', ci = '') {
  vi.stubEnv('COSSACK_E2E_PORT', port);
  vi.stubEnv('COSSACK_TEST_SSG', ssg);
  vi.stubEnv('COSSACK_E2E_SERVER', server);
  vi.stubEnv('COSSACK_E2E_REUSE', reuse);
  vi.stubEnv('CI', ci);
  vi.resetModules();
  return (await import('../playwright.config.js')).default;
}

it('defaults to a fresh production build served by vite preview', async () => {
  const config = await load();
  expect(config.use?.baseURL).toBe('http://localhost:4173');
  expect(config.webServer).toMatchObject({
    command: 'node scripts/e2e-server.mjs --mode production --host localhost --port 4173',
    reuseExistingServer: false,
    stdout: 'pipe',
  });
});

it('retains the reusable dev server for interactive iteration', async () => {
  const config = await load(undefined, '', 'dev');
  expect(config.use?.baseURL).toBe('http://localhost:5173');
  expect(config.webServer).toMatchObject({
    command: 'node scripts/e2e-server.mjs --mode dev --host localhost --port 5173 --reuse',
    reuseExistingServer: false,
    wait: { stdout: /\[e2e\] Server ready at http:/ },
  });
  expect(config.webServer).not.toHaveProperty('url');
  expect(config.webServer).not.toHaveProperty('port');
});

it('permits preview reuse only when explicitly requested', async () => {
  const config = await load(undefined, '', '', '1');
  expect(config.webServer).toMatchObject({
    command: 'node scripts/e2e-server.mjs --mode production --host localhost --port 4173 --reuse',
  });
});

it.each(['dev', ''])('disables server reuse in CI (server=%j)', async server => {
  const config = await load(undefined, '', server, '1', 'true');
  expect(config.webServer).toHaveProperty('reuseExistingServer', false);
  expect(config.webServer).not.toHaveProperty('url');
  expect((config.webServer as { command: string }).command).not.toContain('--reuse');
});

it.each(['', '0', '65536', '15173.5', 'invalid'])('rejects invalid dedicated ports: %j', async port => {
  await expect(load(port)).rejects.toThrow('COSSACK_E2E_PORT must be an integer between 1 and 65535');
});

it.each([
  ['', '', 'node scripts/e2e-server.mjs --mode production --host 127.0.0.1 --port 15173'],
  ['1', '', 'node scripts/e2e-server.mjs --mode production --host 127.0.0.1 --port 15173'],
  ['', 'dev', 'node scripts/e2e-server.mjs --mode dev --host 127.0.0.1 --port 15173'],
])('isolates the dedicated server from existing listeners (SSG=%j, server=%j)', async (ssg, server, command) => {
  const config = await load('15173', ssg, server);
  expect(config.use?.baseURL).toBe('http://127.0.0.1:15173');
  expect(config.webServer).toMatchObject({
    wait: { stdout: /\[e2e\] Server ready at http:/ },
    reuseExistingServer: false, command,
  });
});
