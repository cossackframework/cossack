import { defineConfig } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
// @cossack:cloudflare-start
import { cloudflare } from '@cloudflare/vite-plugin';
// @cossack:cloudflare-end
import { cossackPages } from '@cossackframework/framework/vite-plugin';
import { cossackSecurityPlugin } from '@cossackframework/framework/vite-security-plugin';

export default defineConfig({
  plugins: [
    tailwindcss(),
    // @cossack:cloudflare-start
    cloudflare({
      viteEnvironment: { name: 'ssr' },
    }),
    // @cossack:cloudflare-end
    cossackSecurityPlugin({ devWarning: true }),
    cossackPages(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '~': path.resolve(__dirname, './dist/client'),
    },
  },
  environments: {
    client: {
      build: {
        outDir: 'dist/client',
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
    ssr: {
      // Configured by the cloudflare plugin via viteEnvironment: { name: 'ssr' }
    },
  },
});
