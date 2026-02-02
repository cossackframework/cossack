import { defineConfig } from 'vite'
import path from 'path'
import { cossackPages } from './src/vite-plugin';
import { cossackSecurityPlugin } from './src/vite-security-plugin';

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
    plugins: [
      // Security plugin: strips server-only code from client bundle
      // Must run before cossackPages (enforce: 'pre') to process raw source
      cossackSecurityPlugin({
        mode: 'client', // Only strip in client builds
        devWarning: true, // Warn in development if server code is accessed
      }),
      cossackPages({ mode }),
    ],
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
          entryFileNames: 'assets/[name].[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]',
          format: 'esm',
          // Manual chunk splitting for better caching and code organization
          manualChunks: (id) => {
            // Core framework chunks - our own packages
            if (id.includes('@cossackframework/core') || id.includes('@cossackframework/renderer')) {
              return 'cossack-framework';
            }

            // Vendor chunks for third-party libraries
            if (id.includes('node_modules')) {
              // Split major libraries into their own chunks
              if (id.includes('marked') || id.includes('gray-matter')) {
                return 'vendor-markdown';
              }
              // Other vendor code
              return 'vendor';
            }

            // Page-specific chunks are handled automatically by dynamic imports
            // Each page becomes its own chunk
            return undefined;
          }
        }
      },
    },
  };
});
