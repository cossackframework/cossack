import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Two projects:
 *
 * - `unit` (default `pnpm test`): fast tests that run in-process. They use
 *   default timeouts and full parallelism.
 * - `integration` (`pnpm test:integration`): tests that scaffold and build
 *   real apps, run Vite/tsc/Wrangler/workerd/Chromium, install packages, or
 *   spawn the CLI as a subprocess for most cases. They compete for CPU, so
 *   they run with few workers and long timeouts.
 *
 * Classification rule (by behaviour, not by name): a file is integration when
 * it does any of the above. Name a new heavy file with one of the suffixes
 * matched below (`-acceptance`, `-integration`, `-native`,
 * `-release-scenario`, `-guide-coverage`, `-browser`) and it is picked up
 * automatically. Otherwise add its name to INTEGRATION_FILES. A file whose
 * name matches a suffix but runs fast and in-process goes in UNIT_FILES.
 * Everything else is a unit test and must stay fast.
 */
const INTEGRATION_FILES = [
  // Naming conventions for heavy suites.
  '*-acceptance.test.js',
  '*-integration.test.js',
  '*-native.test.js',
  '*-release-scenario.test.js',
  '*-guide-coverage.test.js',
  // Chromium tests for the CLI's scaffolded UI templates (component tests live in packages/ui/tests/browser).
  '*-browser.test.js',
  // Generated apps: vite build, Node/Deno runtimes, shutdown.
  'generated-*.test.js',
  'production-source-maps.test.js',
  'hydration-diagnostics-runtime.test.js',
  'upgrade-release.test.js',
  'ui-ejection.test.js',
  'aggregate-budget-installed.test.js',
  // Real CLI subprocess matrices and MCP stdio servers.
  'cli-json-matrix.test.js',
  'cli-subprocess.test.js',
  'config-command.test.js',
  'mcp.test.js',
  'workflows-inspection.test.js',
  'vitest-reporter.test.js',
  // Wrangler / workerd / Cloudflare provider and preview fixtures.
  'cloudflare-*-faults.test.js',
  'cloudflare-resource-provider.test.js',
  'preview-service.test.js',
  // Env-gated release scenario (skipped unless an installed root is given).
  'protected-resource-scenario.test.js',
  // tsc or full TypeScript programs over docs, skills and declarations.
  'documentation.test.js',
  'declaration-index.test.js',
  'skill-guide-consistency.test.js',
];

/** Suffix-matched files that are in fact fast and in-process. */
const UNIT_FILES = ['inspection-acceptance.test.js'];

const testsDirectory = fileURLToPath(new URL('./tests', import.meta.url));
const testFiles = fs.readdirSync(testsDirectory).filter(file => file.endsWith('.test.js'));
const isIntegration = (file: string) =>
  !UNIT_FILES.includes(file) && INTEGRATION_FILES.some(pattern => path.matchesGlob(file, pattern));
const toInclude = (files: string[]) => files.map(file => `tests/${file}`);

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: toInclude(testFiles.filter(file => !isIntegration(file))),
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: toInclude(testFiles.filter(isIntegration)),
          testTimeout: 120_000,
          hookTimeout: 120_000,
          maxWorkers: 3,
        },
      },
    ],
  },
});
