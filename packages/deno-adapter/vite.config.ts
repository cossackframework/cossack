import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        vite: path.resolve(__dirname, 'src/vite.ts'),
        'development-runtime': path.resolve(__dirname, 'src/development-runtime.ts'),
      },
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
      external: [/^node:/, 'vite', 'vite/module-runner', 'http-proxy-3', '@cossackframework/core', 'hono', 'hono/deno'],
      output: { entryFileNames: '[name].js' },
    },
  },
});
