import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect whether a system Google Chrome is installed. `channel: 'chrome'`
 * forces Playwright to launch system Chrome — required on platforms where
 * Playwright doesn't ship browser binaries (e.g. Ubuntu 26.04) and works on
 * GitHub Actions ubuntu-latest where Chrome is preinstalled. When absent
 * (e.g. a minimal WSL setup without Chrome), the channel is omitted so
 * Playwright falls back to its bundled Chromium (installed via
 * `playwright install`).
 */
function hasSystemChrome(): boolean {
  for (const c of ['google-chrome', 'google-chrome-stable', 'chrome']) {
    try {
      execSync(`command -v ${c}`, { stdio: 'ignore' });
      return true;
    } catch {
      /* not found — try the next candidate */
    }
  }
  return false;
}

const chromeChannel = hasSystemChrome() ? { channel: 'chrome' as const } : {};

/**
 * The SSG preview server is opt-in: it builds the entire app with SSG before
 * starting a preview server, which is too slow for normal e2e iteration.
 *
 * When COSSACK_TEST_SSG=1 is set, the config swaps the global webServer from
 * `pnpm dev` (5173) to `pnpm run build:ssg && vite preview` (4173) and points
 * the default project's baseURL at the preview server. This way there is only
 * one webServer in effect at a time (Playwright does not reliably merge
 * project-level webServer configs with the top-level one).
 *
 *   pnpm run test:e2e:ssg
 *   # or: COSSACK_TEST_SSG=1 pnpm exec playwright test e2e/pages/ssg.spec.ts
 */
const ssgMode = !!process.env.COSSACK_TEST_SSG;
// Dedicated release runs must not reuse an unrelated generated-app listener.
const requestedPort = process.env.COSSACK_E2E_PORT;
const port = requestedPort === undefined ? (ssgMode ? 4173 : 5173) : Number(requestedPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('COSSACK_E2E_PORT must be an integer between 1 and 65535');
}
const host = requestedPort === undefined ? 'localhost' : '127.0.0.1';
const address = `http://${host}:${port}`;
const command = ssgMode
  ? `pnpm run build:ssg && pnpm exec vite preview --host ${host} --port ${port} --strictPort`
  : `pnpm dev --host ${host} --port ${port} --strictPort`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: 'html',
  use: {
    baseURL: address,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Video recording requires Playwright's ffmpeg binary, which can't be
    // installed on some platforms (e.g. Ubuntu 26.04). Enable only in CI
    // where `playwright install` provides it.
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    {
      name: 'chromium',
      // Prefer system Chrome (channel: 'chrome') when installed — required on
      // platforms where Playwright doesn't ship browser binaries (e.g. Ubuntu
      // 26.04), and works on GitHub Actions ubuntu-latest where Chrome is
      // preinstalled. When system Chrome is absent (e.g. a minimal WSL setup),
      // fall back to Playwright's bundled Chromium.
      use: { ...devices['Desktop Chrome'], ...chromeChannel },
      // In SSG mode, only the SSG suite is relevant; in dev mode, skip the
      // SSG suite (it needs the preview server, not `pnpm dev`).
      testMatch: ssgMode ? '**/e2e/pages/ssg.spec.ts' : '**/e2e/**/*.spec.ts',
      testIgnore: ssgMode ? [] : ['**/e2e/pages/ssg.spec.ts'],
    },
  ],
  webServer: {
    command,
    url: address,
    reuseExistingServer: !process.env.CI && requestedPort === undefined,
    timeout: ssgMode ? 240 * 1000 : 180 * 1000,
    cwd: __dirname,
  },
});
