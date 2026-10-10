import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    lib: {
      entry: { index: path.resolve(__dirname, 'src/index.ts'), server: path.resolve(__dirname, 'src/server.ts') },
      name: '@cossackframework/test-utils',
      fileName: 'index',
      formats: ['es'],
      fileName: () => '[name].mjs',
    },
    rolldownOptions: {
      external: [
        '@cossackframework/core',
        '@cossackframework/renderer',
        'vitest',
        'node:async_hooks',
        'hono'
      ],
    },
  },
});
