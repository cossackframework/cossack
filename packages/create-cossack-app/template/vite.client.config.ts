import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cossackPages } from '@cossackframework/framework/vite-plugin';

export default defineConfig({
  plugins: [cossackPages()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/client/entry-client.ts'),
      name: 'client',
      fileName: 'client',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        dir: 'dist/client',
      },
    },
    minify: false,
    sourcemap: true,
  },
});
