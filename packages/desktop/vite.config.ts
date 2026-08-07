import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        dev: path.resolve(__dirname, 'src/dev.ts'),
      },
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
      external: [/^node:/, 'electron', '@cossackframework/framework/runtime-adapter'],
      output: { entryFileNames: '[name].js' },
    },
  },
});
