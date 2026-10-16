import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// tsserver loads plugins with require(), so the plugin is one CommonJS file.
// The renderer's template analysis is bundled in; TypeScript is not: the plugin
// uses the compiler that loads it.
export default defineConfig({
  build: {
    target: 'node18',
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rolldownOptions: {
      output: { exports: 'default' },
    },
  },
  test: {
    environment: 'node',
    testTimeout: 120_000,
  },
});
