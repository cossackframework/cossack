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
  // Local D1 updates its WAL/SHM files for authenticated reads and writes.
  // Those runtime files are not source code and must never trigger Vite HMR.
  server: {
    watch: {
      ignored: ['**/.wrangler/**'],
    },
  },
  // Solar Icons ships as native ESM. Let Vite serve its deep imports directly
  // so discovering icons from lazy-loaded pages cannot invalidate the client
  // dependency bundle and force a post-load refresh.
  optimizeDeps: {
    exclude: ['@cossackframework/solar-icons'],
  },
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
  build: {
    // Vite leaves SSR output unminified by default. This shared default also
    // covers the separate `vite build --ssr` used by the Node adapter.
    minify: true,
  },
  resolve: {
    // Linked Cossack packages otherwise resolve shared dependencies from both
    // the app and framework workspaces. A single project-root copy prevents
    // Vite's dependency optimizer from repeatedly invalidating the browser.
    dedupe: [
      '@cossackframework/core',
      '@cossackframework/renderer',
      '@cossackframework/framework',
      '@cossackframework/auth',
      '@cossackframework/database',
      '@cossackframework/ui',
      '@cossackframework/solar-icons',
      'hono',
      'reflect-metadata',
    ],
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '~': path.resolve(import.meta.dirname, './dist/client'),
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
      resolve: {
        // UI imports Solar Icons through deep TypeScript-source exports.
        // Bundle the parent UI graph and those icons into Node SSR output
        // instead of leaving imports that Node refuses to type-strip from
        // node_modules in production.
        noExternal: ['@cossackframework/ui', '@cossackframework/solar-icons'],
      },
      // Cloudflare starts the SSR worker eagerly in development. Pre-bundling
      // the large shared packages avoids transforming their full dependency
      // graphs one module at a time on every cold start.
      optimizeDeps: {
        include: [
          '@cossackframework/ui',
          '@cossackframework/auth',
          '@cossackframework/database',
          '@cossackframework/framework/cache',
          'hono/cookie',
        ],
        exclude: ['@cossackframework/solar-icons'],
      },
    },
  },
});
