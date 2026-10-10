/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { cossackPages, cossackLang, cossackMiddlewares, cossackConfig } from './src/vite-plugin.ts';
import { cossackSecurityPlugin } from './src/vite-security-plugin.ts';
import { cossackSsg } from './src/vite-ssg-plugin.ts';
import { processMarkdown } from './src/markdown-processor.ts';
import { fileURLToPath } from 'node:url';
import { workspaceDependencies } from './dev/workspace-dependencies.ts';
import { cossackDevTools } from './dev/devtools.ts';

// Pages arrive through a virtual module, so Vite's initial dependency scan can
// miss their deep icon imports. Pre-bundle only icons used by this demo rather
// than the entire icon library. Keep server storage SDKs out of client entries.
const demoIconDependencies = [
  '@cossackframework/solar-icons/add-circle',
  '@cossackframework/solar-icons/alt-arrow-down',
  '@cossackframework/solar-icons/arrow-right',
  '@cossackframework/solar-icons/cart',
  '@cossackframework/solar-icons/chart',
  '@cossackframework/solar-icons/check-circle',
  '@cossackframework/solar-icons/close-circle',
  '@cossackframework/solar-icons/database',
  '@cossackframework/solar-icons/document-text',
  '@cossackframework/solar-icons/folder',
  // PasswordInput is imported transitively through the UI package.
  '@cossackframework/solar-icons/eye',
  '@cossackframework/solar-icons/eye-closed',
  '@cossackframework/solar-icons/hamburger-menu',
  '@cossackframework/solar-icons/home',
  '@cossackframework/solar-icons/lock',
  '@cossackframework/solar-icons/magnifier',
  '@cossackframework/solar-icons/pen-new-square',
  '@cossackframework/solar-icons/refresh-circle',
  '@cossackframework/solar-icons/routing-2',
  '@cossackframework/solar-icons/server',
  '@cossackframework/solar-icons/settings',
  '@cossackframework/solar-icons/trash-bin-minimalistic',
  '@cossackframework/solar-icons/users-group-rounded',
  '@cossackframework/solar-icons/widget-2',
];

// Bundle related entry points together so the UI and application share one
// Cossack/renderer instance. Optimizing UI alone embeds another renderer and
// breaks template identity. Linked workspace libraries otherwise bypass Vite's
// default dependency optimization and are reloaded module by module on restart.
const sharedDevelopmentDependencies = [
  '@cossackframework/core',
  '@cossackframework/core/devtools',
  '@cossackframework/core/routes',
  '@cossackframework/renderer',
  '@cossackframework/ui',
  '@cossackframework/ui/blocks',
  ...demoIconDependencies,
];

export default defineConfig({
  test: {
    // Playwright owns e2e/**/*.spec.ts. Keeping Vitest on the unit-test tree
    // prevents Playwright suites from being imported outside its runner.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  plugins: [
    workspaceDependencies(['@cossackframework/core', '@cossackframework/renderer', '@cossackframework/ui']
      .map(specifier => path.dirname(fileURLToPath(import.meta.resolve(specifier))))),
    tailwindcss(),
    // Cloudflare plugin is incompatible with Vitest 4's resolve.external defaults.
    // Skip it during testing; unit tests don't need the Workers runtime.
    ...(process.env.VITEST ? [] : [
      cloudflare({
        viteEnvironment: { name: 'ssr' },
      }),
    ]),
    // Security plugin: strips server-only code from client bundle
    // Must run before cossackPages (enforce: 'pre') to process raw source
    cossackSecurityPlugin({
      devWarning: true,
    }),
    cossackPages({ markdownProcessor: processMarkdown }),
    cossackLang(),
    cossackMiddlewares(),
    cossackConfig(),
    // SSG: renders pages marked `@Page({ ssg: true })` to static HTML during
    // `vite build` (via a closeBundle hook). No-op in dev and under vitest.
    cossackSsg(),
    ...(process.env.VITEST ? [] : [cossackDevTools()]),
  ],
  build: {
    // Keep production SSR/worker output minified. Client builds inherit this
    // default as well (which matches Vite's normal production behavior).
    minify: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '~': path.resolve(import.meta.dirname, './dist/client'),
    },
  },
  environments: {
    client: {
      optimizeDeps: { include: sharedDevelopmentDependencies },
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
            codeSplitting: {
              groups: [
                {
                  test: /@cossackframework\/(core|renderer)/,
                  name: 'cossack-framework',
                },
                {
                  test: /node_modules/,
                  name: 'vendor',
                },
              ],
            },
          }
        },
      },
    },
    ssr: {
      optimizeDeps: {
        include: [
          ...sharedDevelopmentDependencies,
          '@cossackframework/renderer/server',
          'hono',
          'hono/http-exception',
          'hono/router/trie-router',
          'hono/cookie',
          'hono/cors',
          'reflect-metadata',
          '@aws-sdk/client-s3',
          '@aws-sdk/s3-request-presigner',
        ],
      },
      // The cloudflare plugin configures the SSR/worker environment
      // with viteEnvironment: { name: 'ssr' }
    },
  },
});
