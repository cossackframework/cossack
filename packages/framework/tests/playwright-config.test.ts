import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function load(port?: string, ssg = '', server = '') {
  vi.stubEnv('COSSACK_E2E_PORT', port);
  vi.stubEnv('COSSACK_TEST_SSG', ssg);
  vi.stubEnv('COSSACK_E2E_SERVER', server);
  vi.stubEnv('COSSACK_E2E_REUSE', '');
  vi.stubEnv('CI', '');
  vi.resetModules();
  return (await import('../playwright.config.js')).default;
}

it('defaults to a fresh production build served by vite preview', async () => {
  const config = await load();
  expect(config.use?.baseURL).toBe('http://localhost:4173');
  expect(config.webServer).toMatchObject({
    command: 'pnpm exec vite build && pnpm exec vite preview --host localhost --port 4173 --strictPort',
    reuseExistingServer: false,
  });
});

it('retains the reusable dev server for interactive iteration', async () => {
  const config = await load(undefined, '', 'dev');
  expect(config.use?.baseURL).toBe('http://localhost:5173');
  expect(config.webServer).toMatchObject({ command: 'pnpm dev --host localhost --port 5173 --strictPort', reuseExistingServer: true });
});

it.each(['', '0', '65536', '15173.5', 'invalid'])('rejects invalid dedicated ports: %j', async port => {
  await expect(load(port)).rejects.toThrow('COSSACK_E2E_PORT must be an integer between 1 and 65535');
});

it.each([
  ['', '', 'pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 15173 --strictPort'],
  ['1', '', 'pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 15173 --strictPort'],
  ['', 'dev', 'pnpm dev --host 127.0.0.1 --port 15173 --strictPort'],
])('isolates the dedicated server from existing listeners (SSG=%j, server=%j)', async (ssg, server, command) => {
  const config = await load('15173', ssg, server);
  expect(config.use?.baseURL).toBe('http://127.0.0.1:15173');
  expect(config.webServer).toMatchObject({ url: 'http://127.0.0.1:15173', reuseExistingServer: false, command });
});
