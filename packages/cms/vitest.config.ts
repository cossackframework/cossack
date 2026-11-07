/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // The DOM environment transforms the linked framework package, whose plugin registry imports the build's virtual module.
    resolve: { alias: { 'virtual:cossack-plugins': fileURLToPath(new URL('./tests/stubs/cossack-plugins.ts', import.meta.url)) } },
    test: {
        include: ['tests/**/*.test.ts', 'app/tests/**/*.test.ts'],
        environment: 'node',
        // Live suites migrate real databases, and one test can run many migrations.
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});
