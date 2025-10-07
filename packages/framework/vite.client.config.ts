import { defineConfig } from 'vite'
import path from 'path'
import { cossackPages } from './src/vite-plugin';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [cossackPages()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '~': path.resolve(__dirname, './dist/client'),
    },
  },
  build: {
    manifest: true,
    outDir: 'dist/client',
    target: 'esnext',
    rollupOptions: {
      input: 'src/client/entry-client.ts',
      output: {
        entryFileNames: '[name].js',
        format: 'esm'
      }
    },
  },
});
