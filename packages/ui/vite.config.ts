import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rolldownOptions: {
      external: [
        '@cossackframework/core',
        '@cossackframework/renderer',
        '@cossackframework/solar-icons',
      ],
    },
  },
});
