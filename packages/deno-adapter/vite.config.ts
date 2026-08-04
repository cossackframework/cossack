import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        desktop: path.resolve(__dirname, 'src/desktop.ts'),
        'desktop-client': path.resolve(__dirname, 'src/desktop-client.ts'),
        'desktop-error': path.resolve(__dirname, 'src/desktop-error.ts'),
      },
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
      external: ['@cossackframework/core', '@cossackframework/framework/runtime-adapter', 'hono', 'hono/deno'],
    },
  },
});
