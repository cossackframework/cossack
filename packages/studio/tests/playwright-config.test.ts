import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it('writes an HTML report without starting a report server', async () => {
  vi.stubEnv('CI', 'true');
  const { default: config } = await import('../playwright.config.js');
  expect(config.reporter).toEqual([['list'], ['html', { open: 'never' }]]);
  expect(config.forbidOnly).toBe(true);
  expect(config.use?.launchOptions).toBeUndefined();
  expect(config.use?.trace).toBe('retain-on-failure');
});
