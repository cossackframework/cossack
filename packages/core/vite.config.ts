// @ts-expect-error - vite types require bundler module resolution
import { defineConfig } from 'vite'
import path from 'path'
import dts from 'vite-plugin-dts'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
    tsconfigPaths(),
  ],
  build: {
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: '@cossackframework/core',
      fileName: 'index',
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
      external: [
        '@cossackframework/renderer',
        'hono',
        'reflect-metadata',
        '@cloudflare/workers-types'
      ]
    }
  },
});
