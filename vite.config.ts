import { defineConfig } from 'vite'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isSsr = mode === 'ssr';

  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '~': path.resolve(__dirname, './dist/client'),
      },
    },
    // Ensure correct environment variables are set
    define: isSsr ? {
      'import.meta.env.DEV': 'false',
    } : {},
    build: {
      // Generate a manifest file for the client build
      manifest: true,
      // SSR build for the worker
      ssr: isSsr,
      // Place the worker script in a separate directory
      outDir: isSsr ? 'dist/worker' : 'dist/client',
      target: 'esnext',
      rollupOptions: {
        input: isSsr
          ? 'src/index.ts' // Worker entry point
          : 'src/client/entry-client.ts', // Client entry point
        output: {
          entryFileNames: isSsr ? 'index.js' : '[name].js',
          format: 'esm'
        }
      },
    },
  }
});