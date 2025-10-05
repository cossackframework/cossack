import { defineConfig } from 'vite'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '~': path.resolve(__dirname, './dist/client'),
    },
  },
  define: {
    'import.meta.env.DEV': 'false',
  },
  build: {
    ssr: true,
    outDir: 'dist/worker',
    target: 'esnext',
    rollupOptions: {
      input: 'src/index.ts',
      output: {
        entryFileNames: 'index.js',
        format: 'esm'
      }
    },
  },
});
