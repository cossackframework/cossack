import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const systemChrome = '/usr/bin/google-chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: !process.env.CI && existsSync(systemChrome) ? { executablePath: systemChrome } : undefined,
  },
  workers: 1,
});
