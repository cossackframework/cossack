/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        // A linked `@romedb/node` lives outside node_modules; load it natively, as one module.
        server: { deps: { external: [/@romedb\/node/, /romedb\/bindings\/node\//] } },
    },
});
