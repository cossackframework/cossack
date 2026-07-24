import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const systemChrome = '/usr/bin/google-chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: existsSync(systemChrome) ? { executablePath: systemChrome } : undefined,
  },
  workers: 1,
});
