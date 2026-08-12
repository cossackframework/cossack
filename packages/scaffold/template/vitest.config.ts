import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Keep unit tests independent from the application Vite config. In
// particular, Cloudflare's Vite environment is for Worker development and is
// not compatible with Vitest's Node SSR environment.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});
