import { defineConfig } from 'vite';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { cossackConfig, cossackLang, cossackMiddlewares, cossackPages } from '@cossackframework/framework/vite-plugin';
import { cossackSecurityPlugin } from '@cossackframework/framework/vite-security-plugin';

export default defineConfig({
  plugins: [
    tailwindcss(),
    cossackSecurityPlugin({ devWarning: true }),
    cossackPages(), cossackLang(), cossackMiddlewares(), cossackConfig(),
  ],
  build: { minify: true },
  resolve: {
    dedupe: [
      '@cossackframework/core', '@cossackframework/renderer',
      '@cossackframework/framework', '@cossackframework/ui', 'hono',
    ],
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '~': path.resolve(import.meta.dirname, './dist/client'),
    },
  },
  environments: {
    client: {
      build: {
        outDir: 'dist/client', target: 'esnext', manifest: true,
        rolldownOptions: {
          input: 'src/client/entry-client.ts',
          output: {
            entryFileNames: 'assets/[name].[hash].js',
            chunkFileNames: 'assets/[name].[hash].js',
            assetFileNames: 'assets/[name].[hash][extname]', format: 'esm',
          },
        },
      },
    },
    ssr: { resolve: { noExternal: ['@cossackframework/ui', 'hono'] } },
  },
});
