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
 * Server modes
 *
 * By default the suite runs against a production build: `vite build` followed
 * by `vite preview`. With `@cloudflare/vite-plugin`, `vite preview` serves the
 * built Worker inside workerd (Miniflare), so RPC, SSE, WebSockets, Durable
 * Objects and the SSG output all run exactly as they would after deploy.
 *
 *   pnpm run test:e2e          # build + preview (production-like, default)
 *   pnpm run test:e2e:dev      # `pnpm dev` (5173) for fast local iteration
 *   pnpm run test:e2e:ssg      # only the SSG suite, against build + preview
 *
 * COSSACK_E2E_SERVER=dev selects the dev server; COSSACK_TEST_SSG=1 restricts
 * the run to e2e/pages/ssg.spec.ts (which needs the built SSG output and is
 * therefore skipped in dev mode).
 */
const ssgMode = !!process.env.COSSACK_TEST_SSG;
const devMode = process.env.COSSACK_E2E_SERVER === 'dev' && !ssgMode;
// Dedicated release runs must not reuse an unrelated generated-app listener.
const requestedPort = process.env.COSSACK_E2E_PORT;
const port = requestedPort === undefined ? (devMode ? 5173 : 4173) : Number(requestedPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('COSSACK_E2E_PORT must be an integer between 1 and 65535');
}
const host = requestedPort === undefined ? 'localhost' : '127.0.0.1';
const address = `http://${host}:${port}`;
// scripts/e2e-build.mjs runs `vite build` (not `pnpm build`, whose declaration
// emit e2e does not need) and skips it when an identical build already exists.
const command = devMode
  ? `pnpm dev --host ${host} --port ${port} --strictPort`
  : `node scripts/e2e-build.mjs && pnpm exec vite preview --host ${host} --port ${port} --strictPort`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,
  // Live progress in the terminal; the HTML report is written but never auto-served,
  // which would otherwise block the run after a failure until Ctrl+C.
  reporter: [['list'], ['html', { open: 'never' }]],
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
      // SSG mode runs only the SSG suite; dev mode skips it because the SSG
      // output only exists after `vite build`.
      testMatch: ssgMode ? '**/e2e/pages/ssg.spec.ts' : '**/e2e/**/*.spec.ts',
      testIgnore: devMode ? ['**/e2e/pages/ssg.spec.ts'] : [],
    },
  ],
  webServer: {
    command,
    url: address,
    // Only the dev server is reused by default: a leftover preview server
    // would serve a stale build. COSSACK_E2E_REUSE=1 opts in for iteration
    // against a preview server you started yourself.
    reuseExistingServer: !process.env.CI && requestedPort === undefined
      && (devMode || process.env.COSSACK_E2E_REUSE === '1'),
    timeout: devMode ? 180 * 1000 : 240 * 1000,
    cwd: __dirname,
  },
});
