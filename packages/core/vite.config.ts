import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
      },
      name: '@cossackframework/core',
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
      external: [
        '@cossackframework/renderer',
        /^hono(?:\/|$)/,
        'reflect-metadata',
      ],
      output: {
        // Preserve public source-module boundaries so applications only retain
        // the core capabilities they actually import.
        preserveModules: true,
        preserveModulesRoot: path.resolve(__dirname, 'src'),
      },
    },
  },
});
