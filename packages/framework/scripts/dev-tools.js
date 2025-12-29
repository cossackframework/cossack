import http from 'http';
import { spawn } from 'child_process';
import url from 'url';

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
      // Use 'code' command which should be available in PATH (WSL/Linux)
      // The -g flag opens file at line/column if provided (e.g. file:10:5)
      // We use shell: true to ensure environment variables (like PATH) are respected
      // detached: true and unref() ensure we don't wait for the editor process
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
