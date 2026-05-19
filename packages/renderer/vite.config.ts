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
      },
      formats: ['es'],
    },
    rolldownOptions: {
      // Ensure we don't bundle dependencies if we had any
      external: [],
    },
  },
  plugins: [
    dts({
      include: ['src'],
    }),
    tsconfigPaths(),
  ],
  test: {
    environment: 'happy-dom',
  }
});
