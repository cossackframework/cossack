/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Chromium + Vite fixture tests for UI components. Run with `pnpm run test:browser`.
// One Chromium server and one Tailwind build are shared through tests/browser/global-setup.js.
export default defineConfig({
    test: {
        include: ['tests/browser/**/*.test.js'],
        environment: 'node',
        globalSetup: ['tests/browser/global-setup.js'],
        maxWorkers: 4, // each file runs its own Chromium; more workers starve timing-sensitive tests
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
});
