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
      return new Response(JSON.stringify({runtime:Deno.version.deno,args:Deno.args,body:await c.req.text(),binding:c.env.DENO_ACCEPTANCE_BINDING}),{headers});
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
      const status = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.terminate();
          reject(new Error('Forbidden upgrade timed out'));
        }, 5000);
        socket.once('close', () => clearTimeout(timer));
        socket.once('open', () => {
          socket.terminate();
          reject(new Error('Forbidden upgrade accepted'));
        });
        socket.once('unexpected-response', (_request, response) => {
          response.resume();
          socket.terminate();
          resolve(response.statusCode);
        });
      });
      expect(status).toBe(403);
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
