import { defineConfig } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
// @cossack:cloudflare-start
import { cloudflare } from '@cloudflare/vite-plugin';
// @cossack:cloudflare-end
import { cossackPages, cossackLang, cossackMiddlewares, cossackConfig } from '@cossackframework/framework/vite-plugin';
import { cossackSecurityPlugin } from '@cossackframework/framework/vite-security-plugin';
import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';

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
    cossackLang(),
    cossackMiddlewares(),
    cossackConfig(),
    // SSG: renders pages marked `@Page({ ssg: true })` to static HTML during
    // `vite build`. Remove or set `enabled: false` if you don't use SSG.
    cossackSsg(),
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
