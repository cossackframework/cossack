import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The root package only orchestrates package-level test scripts and owns
    // no Vitest suites. This guard prevents a root/editor Vitest instance
    // from claiming Playwright's packages/framework/e2e/**/*.spec.ts files.
    // Each package's own Vitest/Vite config remains the source of truth.
    include: ['.vitest-root-disabled/**/*.test.ts'],
  },
});
