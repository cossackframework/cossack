import { defineConfig } from 'vite'
import path from 'path'
import { cossackPages } from './src/vite-plugin';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  if (process.env.COSSACK_DEV) {
    mode = 'development';
  }
  
  return {
    mode: mode, 
    define: {
      // Force DEV to true if we are in our custom dev mode, otherwise let Vite decide
      ...(process.env.COSSACK_DEV ? { 'import.meta.env.DEV': 'true' } : {})
    },
    plugins: [cossackPages({ mode })],
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
  };
});
