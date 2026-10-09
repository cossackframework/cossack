/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        // Chromium tests run separately via `pnpm run test:browser`.
        exclude: ['tests/browser/**', '**/node_modules/**'],
        environment: 'node',
    },
});
