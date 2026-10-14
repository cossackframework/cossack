import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {expect} from '@playwright/test';

/** Exercise the installed app/configuration, without injecting a runtime bridge. */
export async function verifyNodeDevelopmentApplication(root, mode = 'vite') {
  const files = ['src/pages/live/index.ts', '.env.development'];
  const backups = new Map();
  for (const file of files) {
    try { backups.set(file, await fs.readFile(path.join(root, file))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; backups.set(file, null); }
  }
  try {
  const page = path.join(root, 'src/pages/live/index.ts');
  await fs.mkdir(path.dirname(page), { recursive: true });
  await fs.writeFile(path.join(root, '.env.development'), 'NODE_DEV_FILE=mode-file\nNODE_DEV_OVERRIDE=file\nDB_PATH=./mode.sqlite\nSMTP_HOST=localhost\nSMTP_USER=fixture\nSMTP_PASS=fixture\n');
  const source = count => `import { Cossack, Page, State } from '@cossackframework/core'; @Page({ transport: 'durable-object', stateful: false }) export default class Live extends Cossack {
    @State() count = ${count}; @State() binding = '';
    init() { this.binding = [this.env.NODE_DEV_FILE, this.env.NODE_DEV_OVERRIDE, this.env.DB_PATH, typeof this.env.EMAIL?.send].join(':'); }
  }`;
  await fs.writeFile(page, source(7));
  const args = mode === 'script' ? ['scripts/dev.js'] : ['--input-type=module', '-e', `
    import { createServer } from 'vite';
    const server = await createServer({ server: { port: 0, host: 'localhost' } });
    await server.listen();
    console.log('dev server → http://localhost:' + server.httpServer.address().port);
    process.once('SIGTERM', async () => { await server.close(); process.exit(0); });
  `];
  const child = spawn(process.execPath, args, {
    cwd: root, env: { ...process.env, PORT: '0', VITEST: '', COSSACK_LOCAL: '', APP_URL: '', NODE_DEV_OVERRIDE: 'process-value' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  const sockets = [];
  try {
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      return /dev server → http:\/\/localhost:(\d+)/.exec(output)?.[1];
    }, { timeout: 30000 }).toBeTruthy();
    const port = /dev server → http:\/\/localhost:(\d+)/.exec(output)[1];
    const origin = `http://localhost:${port}`;
    const client = await (await fetch(origin + '/@vite/client')).text();
    const token = /const wsToken = "([^"]+)"/.exec(client)?.[1];
    expect(token, client.slice(0, 500)).toBeTruthy();
    const hmr = new WebSocket(origin.replace('http:', 'ws:') + '/?token=' + token, 'vite-hmr');
    sockets.push(hmr);
    const [hmrMessage] = await once(hmr, 'message');
    expect(JSON.parse(String(hmrMessage)).type).toBe('connected');
    const connect = async () => {
      // Connect to the target SSR emitted, encoded as one path segment, as the browser does.
      const html = await (await fetch(origin + '/live')).text();
      const target = JSON.parse(/window\.__INITIAL_STATE__ = (.*?)<\/script>/s.exec(html)[1]).providerTargets.page;
      const query = new URLSearchParams({ routePath: '/live', pathname: '/live', params: '{}' });
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws/page/' + encodeURIComponent(target) + '?' + query, { headers: { origin } });
      sockets.push(socket);
      const state = await Promise.race([
        once(socket, 'message').then(([data]) => JSON.parse(String(data))),
        once(socket, 'close').then(([code]) => { throw new Error('Closed before snapshot: ' + code + '\n' + output); }),
      ]);
      return { socket, state };
    };
    const first = await connect();
    expect(first.state.state.count).toBe(7);
    expect(first.state.state.binding).toBe('mode-file:process-value:./mode.sqlite:function');
    const closed = once(first.socket, 'close');
    await fs.writeFile(page, source(9));
    await closed;
    await expect.poll(async () => {
      try { return (await connect()).state.state.count; }
      catch { return undefined; }
    }, { timeout: 15000 }).toBe(9);
    await fs.writeFile(page, source(10));
    await fs.writeFile(page, source(11));
    await expect.poll(async () => {
      try { return (await connect()).state.state.count; }
      catch { return undefined; }
    }, { timeout: 15000 }).toBe(11);
    expect(hmr.readyState).toBe(WebSocket.OPEN);
    expect((await fetch(origin + '/')).status).toBe(200);
  } finally {
    for (const socket of sockets) socket.terminate();
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited;
    clearTimeout(kill);
    expect(signal, output).toBeNull();
    expect([0, 143], output).toContain(code);
  }
  } finally {
    for (const [file, content] of backups) {
      if (content === null) await fs.rm(path.join(root, file), {force:true});
      else await fs.writeFile(path.join(root, file), content);
    }
  }
}
