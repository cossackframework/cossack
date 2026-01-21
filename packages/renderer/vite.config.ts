import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        server: resolve(__dirname, 'src/server.ts'),
        plugin: resolve(__dirname, 'src/plugin.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'typescript',
        'magic-string',
        'htmlparser2',
        'vite'
      ],
    },
  },
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
    tsconfigPaths(),
  ],
});