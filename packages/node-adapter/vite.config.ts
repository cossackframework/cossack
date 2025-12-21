import { defineConfig } from 'vite'
import path from 'path'
import dts from 'vite-plugin-dts'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
    tsconfigPaths(),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: '@cossackframework/node-adapter',
      fileName: 'index',
      formats: ['es'],
    },
    outDir: 'dist',
    rollupOptions: {
        external: ['ws', 'http', 'url', '@cossackframework/core']
    }
  },
});
