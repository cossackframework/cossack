import { defineConfig } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { cossackPages } from '@cossackframework/framework/vite-plugin';
import { cossackSecurityPlugin } from '@cossackframework/framework/vite-security-plugin';

export default defineConfig(({ mode }) => {
  return {
    mode,
    plugins: [
      tailwindcss(),
      cossackSecurityPlugin({ mode: 'client', devWarning: true }),
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
        },
      },
    },
  };
});
