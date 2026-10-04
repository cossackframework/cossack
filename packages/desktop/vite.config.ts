import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        dev: path.resolve(__dirname, 'src/dev.ts'),
        'development-runtime': path.resolve(__dirname, 'src/development-runtime.ts'),
      },
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
      external: [/^node:/, 'electron', 'vite'],
      output: { entryFileNames: '[name].js' },
    },
  },
});
