import path from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {
  cossackConfig,
  cossackLang,
  cossackMiddlewares,
  cossackPages,
} from '@cossackframework/framework/vite-plugin';
import { cossackSecurityPlugin } from '@cossackframework/framework/vite-security-plugin';

export default defineConfig({
  root: 'app',
  build: {
    emptyOutDir: true,
  },
  plugins: [
    tailwindcss(),
    cossackSecurityPlugin({ devWarning: true }),
    cossackPages(),
    cossackLang(),
    cossackMiddlewares(),
    cossackConfig(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './app/src'),
    },
  },
  environments: {
    client: {
      build: {
        outDir: '../dist/app/client',
        emptyOutDir: true,
        target: 'esnext',
        manifest: true,
        rolldownOptions: {
          input: 'src/client/entry-client.ts',
          output: {
            entryFileNames: 'assets/[name].[hash].js',
            chunkFileNames: 'assets/[name].[hash].js',
            assetFileNames: 'assets/[name].[hash][extname]',
            format: 'esm',
          },
        },
      },
    },
  },
});
