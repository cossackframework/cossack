import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { chromium, expect } from '@playwright/test';

export async function writeDenoRuntimeAcceptance(root) {
  for (const [route, transport] of [
    ['deno-http', 'http'],
    ['deno-sse', 'sse'],
    ['deno-live', 'durable-object'],
  ]) {
    const file = path.join(root, 'src/pages', route, 'index.ts');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `
      import {Cossack,Page,State,Server} from '@cossackframework/core';
      import {html} from '@cossackframework/renderer';
      @Page({transport:'${transport}',stateful:false}) export default class RuntimeCheck extends Cossack {
        @State() count=0;
        @Server() increment(){const privateMarker='DENO_SERVER_ONLY_ACCEPTANCE';this.count+=2;return {runtime:Deno.version.deno,privateMarker};}
        render(){return html\`<main><span id="count">\${this.count}</span><button @click="\${()=>this.increment()}">Increment</button></main>\`;}
      }
    `,
    );
  }
  const api = path.join(root, 'src/pages/api/deno-check.ts');
  await fs.mkdir(path.dirname(api), { recursive: true });
  await fs.writeFile(
    api,
    `
    import {defineApi} from '@cossackframework/framework/api';
    export const POST=defineApi({handler:async({c})=>{
      const headers=new Headers({'content-type':'application/json'});
      headers.append('set-cookie','first=1; Path=/');headers.append('set-cookie','second=2; Path=/');
      return new Response(JSON.stringify({runtime:Deno.version.deno,pid:Deno.pid,url:c.req.url,control:Deno.env.get('COSSACK_DENO_DEVELOPMENT')??null,privateHeader:c.req.header('x-cossack-deno-token')??null,override:c.env.DENO_DEV_OVERRIDE,args:Deno.args,body:await c.req.text(),binding:c.env.DENO_ACCEPTANCE_BINDING}),{headers});
    }});
  `,
  );
}

export async function verifyDenoRuntimeApplication(root, binary = process.env.COSSACK_DENO_BINARY ?? 'deno') {
  async function inspectChunks(directory, client) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspectChunks(file, client);
      else if (entry.name.endsWith('.js')) {
        const source = await fs.readFile(file, 'utf8');
        expect(source, file).not.toContain('cloudflare:workers');
        if (client) expect(source, file).not.toContain('DENO_SERVER_ONLY_ACCEPTANCE');
      }
    }
  }
  await inspectChunks(path.join(root, 'dist/client'), true);
  await inspectChunks(path.join(root, 'dist/server'), false);
  const child = spawn(binary, ['task', 'start'], {
    cwd: root,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', APP_URL: '', DENO_ACCEPTANCE_BINDING: 'binding-kept' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const exited = once(child, 'exit');
  // Observe spawn errors immediately, including before readiness polling finishes.
  exited.catch(() => {});
  let browser;
  let failure;
  try {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null || child.signalCode !== null) throw new Error(output);
          return /Listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
        },
        { timeout: 30000 },
      )
      .toBeTruthy();
    const origin = /Listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    const native = await fetch(origin + '/api/deno-check', { method: 'POST', body: 'request-body' });
    expect(native.status).toBe(200);
    expect(native.headers.getSetCookie()).toEqual(['first=1; Path=/', 'second=2; Path=/']);
    expect(await native.json()).toMatchObject({
      runtime: expect.stringMatching(/^2\./),
      body: 'request-body',
      binding: 'binding-kept',
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const route of ['deno-http', 'deno-sse', 'deno-live']) {
      const response = await page.goto(origin + '/' + route);
      expect(response.status()).toBe(200);
      await expect(page.locator('#count')).toHaveText('0');
      await page.getByRole('button', { name: 'Increment', exact: true }).click();
      await expect(page.locator('#count')).toHaveText('2');
    }
    expect(errors).toEqual([]);
    const query = new URLSearchParams({ routePath: '/deno-live', pathname: '/deno-live', params: '{}' });
    for (const [target, requestOrigin] of [
      ['user:anonymous', 'https://untrusted.example'],
      ['user:other', origin],
    ]) {
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws/page/' + target + '?' + query, {
        headers: { origin: requestOrigin },
      });
      socket.on('error', () => {});
      const outcome = await new Promise((resolve, reject) => {
        const frames = [];
        const rejectOrigin = requestOrigin !== origin;
        const timer = setTimeout(() => {
          socket.terminate();
          reject(new Error('Forbidden upgrade timed out'));
        }, 5000);
        socket.once('close', code => {
          clearTimeout(timer);
          if (!rejectOrigin) resolve({ code, frames });
        });
        socket.on('message', data => {
          try { frames.push(JSON.parse(String(data))); }
          catch (error) { socket.terminate(); reject(error); }
        });
        socket.once('open', () => {
          if (rejectOrigin) {
            socket.terminate();
            reject(new Error('Forbidden origin upgrade accepted'));
          }
        });
        socket.once('unexpected-response', (_request, response) => {
          response.resume();
          socket.terminate();
          resolve({ status: response.statusCode });
        });
      });
      if (requestOrigin !== origin) expect(outcome).toEqual({ status: 403 });
      else expect(outcome).toEqual({ code: 1008, frames: [{
        type: 'authorization-error', code: 'COSSACK_REALTIME_AUTH_CHANGED',
        message: 'Realtime authorization changed. Reload the page to reconnect.',
      }] });
    }
  } catch (error) {
    failure = new Error(`${error.stack}\nDeno output:\n${output}`);
  } finally {
    await browser?.close();
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited;
    clearTimeout(kill);
    if (!failure) {
      expect(signal, output).not.toBe('SIGKILL');
      expect(code === 0 || code === 143 || signal === 'SIGTERM', output).toBe(true);
    }
  }
  if (failure) throw failure;
}

/** Exercise the public CLI against the real generated server, including JSON isolation. */
export async function verifyDenoCliStartup(root, binary, cli) {
  const { createServer } = await import('node:net');
  const { fileURLToPath } = await import('node:url');
  cli ??= fileURLToPath(new URL('../../bin/cossack.js', import.meta.url));
  for (const json of [false, true]) {
    const listener = createServer();
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const port = listener.address().port;
    await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      [cli, 'start', ...(json ? ['--json'] : []), '--', '--application-option', 'private argument value'],
      {
        // Startup must find the app root before resolving assets and Deno configuration.
        cwd: path.join(root, 'src'),
        env: {
          ...process.env,
          COSSACK_DENO_BINARY: binary,
          PORT: String(port),
          HOST: '127.0.0.1',
          APP_URL: '',
          DENO_ACCEPTANCE_BINDING: 'cli-binding',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exited = once(child, 'exit');
    exited.catch(() => {});
    let failure;
    try {
      await expect
        .poll(
          async () => {
            if (child.exitCode !== null || child.signalCode !== null) throw new Error(stdout + stderr);
            try {
              const response = await fetch(origin + '/api/deno-check', {
                method: 'POST',
                body: 'cli-body',
                signal: AbortSignal.timeout(1000),
              });
              return response.ok ? response.json() : undefined;
            } catch {
              return undefined;
            }
          },
          { timeout: 20000 },
        )
        .toMatchObject({
          runtime: expect.stringMatching(/^2\./),
          body: 'cli-body',
          binding: 'cli-binding',
          args: ['--', '--application-option', 'private argument value'],
        });
    } catch (error) {
      failure = error;
    } finally {
      // Test both supported terminal signals through the parent CLI.
      child.kill(json ? 'SIGINT' : 'SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
      const [code, signal] = await exited;
      clearTimeout(kill);
      if (!failure) {
        expect({ code, signal }, stdout + stderr).toEqual({ code: 0, signal: null });
        if (json) {
          expect(stderr).toBe('');
          expect(stdout).not.toContain('private argument value');
          const events = stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          expect(events.map((event) => event.data.event)).toEqual(['started', 'stopped']);
          for (const event of events)
            expect(event).toMatchObject({
              schemaVersion: 1,
              command: 'start',
              ok: true,
              data: { adapter: 'deno', tool: 'deno' },
            });
          expect(events[1].data.reason).toBe('requested');
          expect(() => process.kill(events[0].data.pid, 0)).toThrow();
        } else {
          expect(stdout).toContain('start   deno dist/server/index.js');
          expect(stdout).not.toContain('"schemaVersion"');
        }
        await expect
          .poll(() =>
            fetch(origin, { signal: AbortSignal.timeout(1000) }).then(
              () => true,
              () => false,
            ),
          )
          .toBe(false);
      }
    }
    if (failure) throw new Error(`${failure.stack}\nCLI stdout:\n${stdout}\nCLI stderr:\n${stderr}`);
  }
}

export async function verifyDenoDevelopmentApplication(root, crash = false) {
  const backups = new Map();
  for (const file of ['.env.development', 'src/index.ts', 'src/pages/deno-http/index.ts']) {
    try { backups.set(file, await fs.readFile(path.join(root, file))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; backups.set(file, null); }
  }
  try {
    await checkDenoDevelopmentApplication(root, crash);
  } finally {
    for (const [file, content] of backups) {
      if (content === null) await fs.rm(path.join(root, file), { force: true });
      else await fs.writeFile(path.join(root, file), content);
    }
  }
}

async function checkDenoDevelopmentApplication(root, crash) {
  await fs.writeFile(
    path.join(root, '.env.development'),
    'DENO_ACCEPTANCE_BINDING=mode-file\nDENO_DEV_OVERRIDE=file-value\n',
  );
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createServer } from 'vite';
    const server = await createServer({ server: { port: 0, host: '127.0.0.1' } });
    await server.listen();
    console.log('DENO_DEV_ORIGIN=http://127.0.0.1:' + server.httpServer.address().port);
    process.on('message', async message => { if (message === 'STOP') { await server.close(); process.exit(0); } });
  `,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITEST: '',
        APP_URL: '',
        DENO_DEV_OVERRIDE: 'process-value',
        DENO_ACCEPTANCE_BINDING: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const exited = once(child, 'exit');
  exited.catch(() => {});
  let browser, pid, failure;
  const sockets = [];
  try {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null || child.signalCode !== null) throw new Error(output);
          return /DENO_DEV_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
        },
        { timeout: 30000 },
      )
      .toBeTruthy();
    const origin = /DENO_DEV_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    const client = await (await fetch(origin + '/@vite/client')).text();
    const token = /const wsToken = "([^"]+)"/.exec(client)?.[1];
    expect(token).toBeTruthy();
    const hmr = new WebSocket(origin.replace('http:', 'ws:') + '/?token=' + token, 'vite-hmr');
    sockets.push(hmr);
    await once(hmr, 'message');
    const query = new URLSearchParams({ routePath: '/deno-live', pathname: '/deno-live', params: '{}' });
    const cold = new WebSocket(origin.replace('http:', 'ws:') + '/ws/page/user:anonymous?' + query, {
      headers: { origin },
    });
    sockets.push(cold);
    const [state] = await once(cold, 'message');
    expect(JSON.parse(String(state)).state.count).toBe(0);
    const native = async () => {
      const response = await fetch(origin + '/api/deno-check', {
        method: 'POST',
        body: 'development',
        signal: AbortSignal.timeout(10000),
      });
      expect(response.status, output).toBe(200);
      expect(response.headers.getSetCookie()).toEqual(['first=1; Path=/', 'second=2; Path=/']);
      const result = await response.json();
      expect(result).toMatchObject({
        runtime: expect.stringMatching(/^2\./),
        body: 'development',
        binding: 'mode-file',
        override: 'process-value',
        control: null,
        privateHeader: null,
        url: origin + '/api/deno-check',
      });
      return result;
    };
    pid = (await native()).pid;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    for (const route of ['deno-http', 'deno-sse', 'deno-live']) {
      await page.goto(origin + '/' + route);
      await expect(page.locator('#count')).toHaveText('0');
      await page.getByRole('button', { name: 'Increment', exact: true }).click();
      await expect(page.locator('#count')).toHaveText('2');
    }
    const file = path.join(root, 'src/pages/deno-http/index.ts');
    const source = await fs.readFile(file, 'utf8');
    const closed = once(cold, 'close');
    const reloaded = page.waitForEvent('load', { timeout: 20000 });
    await fs.writeFile(file, source.replace('this.count+=2', 'this.count+=5'));
    await closed;
    await expect
      .poll(
        async () => {
          try {
            return (await native()).pid;
          } catch {
            return pid;
          }
        },
        { timeout: 20000 },
      )
      .not.toBe(pid);
    expect(() => process.kill(pid, 0)).toThrow();
    pid = (await native()).pid;
    expect(hmr.readyState).toBe(WebSocket.OPEN);
    await reloaded;
    await page.goto(origin + '/deno-http');
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await expect(page.locator('#count')).toHaveText('5');
    await browser.close();
    browser = undefined;
    for (const socket of sockets) socket.terminate();
    const entryFile = path.join(root, 'src/index.ts');
    const entrySource = await fs.readFile(entryFile, 'utf8');
    await fs.writeFile(entryFile, entrySource + "\nthrow new Error('DENO_STARTUP_FAILURE_FIXTURE');\n");
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(origin + '/api/deno-check', { method: 'POST', signal: AbortSignal.timeout(10000) }))
              .status;
          } catch {
            return 0;
          }
        },
        { timeout: 20000 },
      )
      .toBe(500);
    await fs.writeFile(entryFile, entrySource + (crash ? '\nruntime.dispose = () => new Promise(() => {});\n' : ''));
    await expect
      .poll(
        async () => {
          try {
            return (await native()).pid;
          } catch {
            return pid;
          }
        },
        { timeout: 20000 },
      )
      .not.toBe(pid);
    pid = (await native()).pid;
    if (crash) child.kill('SIGKILL');
  } catch (error) {
    failure = new Error(`${error.stack}\n${output}`);
  } finally {
    await browser?.close();
    for (const socket of sockets) socket.terminate();
    if (child.connected) child.send('STOP');
    else child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    const [code, signal] = await exited;
    clearTimeout(timer);
    if (!failure) {
      expect({ code, signal }, output).toEqual(crash ? { code: null, signal: 'SIGKILL' } : { code: 0, signal: null });
      await expect
        .poll(
          async () => {
            try {
              process.kill(pid, 0);
              // Container PID 1 may retain a terminated orphan as a zombie.
              if (process.platform === 'linux') {
                const state = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
                return state.slice(state.lastIndexOf(')') + 2).startsWith('Z');
              }
              return false;
            } catch {
              return true;
            }
          },
          { timeout: 10000 },
        )
        .toBe(true);
    }
  }
  if (failure) throw failure;
}
