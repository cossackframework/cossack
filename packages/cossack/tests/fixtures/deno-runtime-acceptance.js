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
      return new Response(JSON.stringify({runtime:Deno.version.deno,body:await c.req.text(),binding:c.env.DENO_ACCEPTANCE_BINDING}),{headers});
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
