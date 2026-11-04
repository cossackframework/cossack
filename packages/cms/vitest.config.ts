/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts', 'app/tests/**/*.test.ts'],
        environment: 'node',
        // Live suites migrate real databases, and one test can run many migrations.
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});
