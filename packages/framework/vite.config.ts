import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import url from 'url';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { cossackPages } from './src/vite-plugin';
import { cossackSecurityPlugin } from './src/vite-security-plugin';

function cossackDevTools(): Plugin {
  return {
    name: 'cossack-devtools',
    configureServer() {
      const PORT = 3333;

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
            console.log('[DevTools] Opening:', file);
            const child = spawn('code', ['-g', String(file)], {
              stdio: 'ignore',
              shell: true,
              detached: true
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

      server.listen(PORT, () => {
        console.log(`[DevTools] Server listening on http://localhost:${PORT}`);
      });
    },
  };
}

export default defineConfig({
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
    cossackPages(),
    cossackDevTools(),
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
            codeSplitting: {
              groups: [
                {
                  test: /@cossackframework\/(core|renderer)/,
                  name: 'cossack-framework',
                },
                {
                  test: /node_modules[\/\\](marked|gray-matter)/,
                  name: 'vendor-markdown',
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
