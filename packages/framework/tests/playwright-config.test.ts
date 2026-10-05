import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function load(port?: string, ssg = '') {
  vi.stubEnv('COSSACK_E2E_PORT', port);
  vi.stubEnv('COSSACK_TEST_SSG', ssg);
  vi.stubEnv('CI', '');
  vi.resetModules();
  return (await import('../playwright.config.js')).default;
}

it('retains interactive defaults while binding the declared port strictly', async () => {
  const config = await load();
  expect(config.use?.baseURL).toBe('http://localhost:5173');
  expect(config.webServer).toMatchObject({ command: 'pnpm dev --host localhost --port 5173 --strictPort', reuseExistingServer: true });
});

it.each(['', '0', '65536', '15173.5', 'invalid'])('rejects invalid dedicated ports: %j', async port => {
  await expect(load(port)).rejects.toThrow('COSSACK_E2E_PORT must be an integer between 1 and 65535');
});

it.each(['', '1'])('isolates the dedicated dev or SSG server from existing listeners (SSG=%j)', async ssg => {
  const config = await load('15173', ssg);
  expect(config.use?.baseURL).toBe('http://127.0.0.1:15173');
  expect(config.webServer).toMatchObject({
    url: 'http://127.0.0.1:15173', reuseExistingServer: false,
    command: ssg ? 'pnpm run build:ssg && pnpm exec vite preview --host 127.0.0.1 --port 15173 --strictPort' : 'pnpm dev --host 127.0.0.1 --port 15173 --strictPort',
  });
});
