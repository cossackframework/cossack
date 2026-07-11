import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: '@cossackframework/test-utils',
      fileName: 'index',
      formats: ['es', 'cjs'],
    },
    rolldownOptions: {
      external: [
        '@cossackframework/core',
        '@cossackframework/renderer',
        'vitest'
      ],
    },
  },
});
