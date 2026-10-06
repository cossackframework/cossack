import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect } from 'vitest';
import { chromium } from '@playwright/test';

const PRIVATE = 'PRIVATE_BROWSER_COMPILER_SECRET_4921';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function verifyCompilerBrowserPrivacy(root, { allowedPaths = [] } = {}) {
  const filename = path.join(root, 'src/pages/compiler-browser.ts');
  const valid = `import {Cossack,Page,Server} from '@cossackframework/core';
import {html} from '@cossackframework/renderer';
@Page({transport:'http'}) export default class CompilerBrowserPage extends Cossack {
 @Server() private compilerOnly(){return 'unused';}
 render(){return html\`<p>Compiler browser recovery passed</p>\`;}
}`;
  const malformed = valid.replace("@Server() private compilerOnly(){return 'unused';}", `@Server() private compilerOnly(){const secret='${PRIVATE}';const broken=;return secret;}`);
  await fs.writeFile(filename, malformed);
  await fs.writeFile(path.join(root, 'src/pages/layout.ts'), "import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';@Page()export default class Layout extends Cossack{render(){return html`${this.children}`;}}\n");
  await fs.rm(path.join(root, 'src/pages/error.ts'), { force: true });
  let child, exited, output = '', browser, spawnFailed = false;
  const launch = () => {
  child = spawn(process.execPath, ['--input-type=module', '-e', `
import {createServer} from 'vite';
const server=await createServer({root:${JSON.stringify(root)},logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:${JSON.stringify([root, ...allowedPaths])}}}});
await server.listen();console.log('COMPILER_BROWSER_ORIGIN=http://127.0.0.1:'+server.httpServer.address().port);
process.on('message',async()=>{await server.close();process.exit(0);});
`], { cwd: root, env: { ...process.env, NODE_ENV: 'development', VITEST: '', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_LOG_PATH: path.join(root, 'compiler-browser-private.log') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32' });
  child.on('error', () => { spawnFailed = true; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; if (output.length > 2 * 1024 * 1024) kill(); });
  exited = once(child, 'exit').catch(() => undefined);
  };
  const kill = () => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(kill, 140000);
  launch();
  try {
    await expect.poll(() => spawnFailed || child.exitCode !== null || /COMPILER_BROWSER_ORIGIN=/.test(output), { timeout: 45000 }).toBe(true);
    let refusedMalformedStartup = false;
    if (child.exitCode !== null || spawnFailed) {
      // A malformed server may correctly refuse startup before exposing any HTTP endpoint.
      // Generic process death, module resolution failure, and missing native tools do not pass.
      expect(spawnFailed).toBe(false);
      expect(child.exitCode).not.toBe(0);
      expect(output.replace(/\u001b\[[0-9;]*m/g, '')).toContain('compiler-browser.ts');
      expect(output).toMatch(/Unexpected|Expression expected|Parse error|Expected|Transform failed/i);
      expect(output.replace(/\u001b\[[0-9;]*m/g, '')).toContain(PRIVATE);
      expect(output).not.toContain('COMPILER_BROWSER_ORIGIN=');
      refusedMalformedStartup = true;
      await fs.writeFile(filename, valid);
      output += '\nHEALTHY_PROCESS_START\n';
      launch();
      await expect.poll(() => /COMPILER_BROWSER_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1], { timeout: 45000 }).toBeTruthy();
    }
    const origin = /COMPILER_BROWSER_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const frames = [], diagnostics = [];
    page.on('websocket', socket => socket.on('framereceived', frame => frames.push(String(frame.payload))));
    page.on('console', message => diagnostics.push(message.text()));
    page.on('pageerror', error => diagnostics.push(error.message));
    const assertPublic = async () => {
      const overlay = await page.evaluate(() => Array.from(document.querySelectorAll('vite-error-overlay')).map(node => node.shadowRoot?.textContent ?? node.textContent).join('\n'));
      expect((await page.content()) + overlay + frames.join('\n') + diagnostics.join('\n')).not.toContain(PRIVATE);
      expect(overlay + frames.join('\n')).not.toContain(filename);
    };
    const safeResponse = async response => {
      expect(response.status()).toBe(500);
      const requestId = response.headers()['x-cossack-request-id'];
      expect(requestId).toMatch(UUID);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'Internal Server Error', code: 'COSSACK_RUNTIME_FAILED', requestId });
      await expect.poll(() => output, { timeout: 10000 }).toContain(requestId);
      return requestId;
    };
    if (!refusedMalformedStartup) {
      const startup = await page.goto(origin + '/compiler-browser');
      await safeResponse(startup);
      await assertPublic();
      await expect.poll(() => output.replace(/\u001b\[[0-9;]*m/g, ''), { timeout: 10000 }).toContain(PRIVATE);
      await fs.writeFile(filename, valid);
    }
    await expect.poll(async () => { const r = await fetch(origin + '/compiler-browser', { signal: AbortSignal.timeout(5000) }); return r.status === 200 && (await r.text()).includes('Compiler browser recovery passed'); }, { timeout: 20000 }).toBe(true);
    await page.goto(origin + '/compiler-browser');
    await expect.poll(() => frames.some(frame => frame.includes('"type":"connected"')), { timeout: 15000 }).toBe(true);
    await expect.poll(() => page.locator('p').filter({ hasText: 'Compiler browser recovery passed' }).count()).toBe(1);
    frames.length = 0;
    diagnostics.length = 0;
    await fs.writeFile(filename, malformed);
    // A real invalidated browser module produces an HMR error, reload, or update frame.
    await expect.poll(() => frames.some(frame => /"type":"(?:error|full-reload|update)"/.test(frame)), { timeout: 20000 }).toBe(true);
    let fault;
    await expect.poll(async () => { fault = await page.request.get(origin + '/compiler-browser'); return fault.status(); }, { timeout: 20000 }).toBe(500);
    await safeResponse(fault);
    await assertPublic();
    await fs.writeFile(filename, valid);
    await expect.poll(async () => { const r = await page.request.get(origin + '/compiler-browser'); return r.status() === 200 && (await r.text()).includes('Compiler browser recovery passed'); }, { timeout: 20000 }).toBe(true);
    await page.goto(origin + '/compiler-browser');
    await expect.poll(() => page.locator('p').filter({ hasText: 'Compiler browser recovery passed' }).count()).toBe(1);
    await assertPublic();
    expect(child.exitCode).toBeNull();
    return { startup: refusedMalformedStartup ? 'refused-with-private-parse-diagnostic' : 'redacted', hmr: 'redacted', recovered: true };
  } finally {
    await browser?.close();
    const diagnosticDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-compiler-browser-private-'));
    await fs.chmod(diagnosticDirectory, 0o700);
    await fs.writeFile(path.join(diagnosticDirectory, 'terminal.log'), output, { mode: 0o600 });
    clearTimeout(timer);
    if (child.exitCode === null && child.connected) child.send('close');
    let cleanup;
    try { await Promise.race([exited, new Promise(resolve => { cleanup = setTimeout(() => { kill(); resolve(); }, 8000); })]); }
    finally { clearTimeout(cleanup); if (child.exitCode === null) { kill(); await exited; } }
  }
}
