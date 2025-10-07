import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cossackPages } from '@cossackframework/framework/vite-plugin';

export default defineConfig({
  plugins: [cossackPages()],
  build: {
    ssr: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'worker',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        dir: 'dist/worker',
      },
    },
    minify: false,
    sourcemap: true,
  },
});
