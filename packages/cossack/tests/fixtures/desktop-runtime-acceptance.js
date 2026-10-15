import { launchDesktopDevelopmentCli } from './desktop-development-driver.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { _electron, expect } from '@playwright/test';

/**
 * Replace the one occurrence of `search`. A missing anchor means the generated
 * source changed; fail instead of writing the source back unchanged.
 */
function replaceOnce(source, search, replacement) {
  const index = source.indexOf(search);
  if (index === -1 || source.includes(search, index + search.length))
    throw new Error(`Desktop acceptance expects exactly one ${JSON.stringify(search)} in the generated source:\n${source}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

export async function writeDesktopRuntimeAcceptance(root) {
  const entryFile = path.join(root, 'src/desktop/index.ts');
  const entry = await fs.readFile(entryFile, 'utf8');
  // Test-only main-process reference to the public result; never exposed to renderers.
  await fs.writeFile(
    entryFile,
    replaceOnce(
      entry,
      '  configureDesktopClose({',
      '  (globalThis as any).__desktopAcceptanceApplication = desktop;\n  configureDesktopClose({',
    ),
  );
  // Static-file routing: hashed /assets/* skips the application; public/ files
  // pass global and page policies first. The marker shows the pipeline ran.
  await fs.writeFile(
    path.join(root, 'src/bootstrap/middlewares.ts'),
    `
    import type { MiddlewareHandler } from 'hono';
    const middlewares: MiddlewareHandler[] = [async (c, next) => {
      if (c.req.path.startsWith('/guarded/') && c.req.header('x-role') !== 'admin') return c.text('global denied', 401);
      await next();
      if (c.req.method === 'GET' || c.req.method === 'HEAD') c.header('x-desktop-pipeline', 'ran');
    }];
    export default middlewares;
  `,
  );
  await fs.mkdir(path.join(root, 'src/pages/vault'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src/pages/vault/index.ts'),
    `
    import {Cossack,Page} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    @Page({transport:'http',middlewares:[async (c,next)=>{
      if(c.req.header('x-vault')!=='open')return c.text('vault denied',403);
      await next();c.header('x-vault-policy','ran');
    }]})
    export default class Vault extends Cossack {render(){return html\`<main>vault SSR</main>\`;}}
  `,
  );
  for (const [directory, body] of [['vault', 'vault static body'], ['guarded', 'guarded static body']]) {
    await fs.mkdir(path.join(root, 'public', directory), { recursive: true });
    await fs.writeFile(path.join(root, 'public', directory, 'record.txt'), body);
  }
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src/pages/api/desktop-write.ts'),
    `
    import {defineApi} from '@cossackframework/framework/api';
    import {writeFile} from 'node:fs/promises';
    import path from 'node:path';
    import type {DesktopShell} from '@cossackframework/desktop';
    export const POST=defineApi({handler:async({c})=>{
      const shell=c.env.COSSACK_DESKTOP as DesktopShell;
      await writeFile(path.join(shell.app.getPath('userData'),'foreign-write.txt'),'unexpected');
      return new Response('written');
    }});
  `,
  );
  await fs.writeFile(
    path.join(root, 'src/pages/index.ts'),
    `
    import {Cossack,Page,State,ClientState,Server,Client,rpc$} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    import {enableDevTools} from '@cossackframework/framework/client/devtools';
    import type {DesktopShell} from '@cossackframework/desktop';
    import {readFile,writeFile} from 'node:fs/promises';
    import path from 'node:path';
    @Page({transport:'http'}) export default class DesktopCheck extends Cossack {
      @State() count=0;
      @State() owner=0;
      @State() configuration='';
      @ClientState() nativeResult='';
      @ClientState() htmlResult='';
      @ClientState() cancelResult='';
      shell(){return this.env.COSSACK_DESKTOP as DesktopShell;}
      storage(){return path.join(this.shell().app.getPath('userData'),'acceptance-count.txt');}
      async init(){this.configuration=String(this.env.DESKTOP_RELOAD_ACCEPTANCE??'');try{this.count=Number(await readFile(this.storage(),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
      @Server() async increment(){this.count++;this.owner=this.shell().window.id;await writeFile(this.storage(),String(this.count));}
      @Server() async *stream(){this.count++;yield this.count;this.count++;await writeFile(this.storage(),String(this.count));return this.count;}
      @Server() native(){return new Response(new Uint8Array([0,255,128]),{status:201,headers:{'X-Native-Test':'kept'}});}
      @Server() nativeHtml(){return new Response('<p>Native HTML remains opaque</p>',{headers:{'Content-Type':'text/html'}});}
      @Server() async waitForCancel(){await writeFile(path.join(this.shell().app.getPath('userData'),'cancel-started.txt'),'started');await new Promise(resolve=>setTimeout(resolve,5000));return 'late';}
      @Client() async runHtml(){const result=await rpc$(this.nativeHtml());this.htmlResult=result?await result.text():'';}
      @Client() async runCancellation(){const call=rpc$(this.waitForCancel());(window as any).__desktopPendingCall=call;try{await call;}catch(error){this.cancelResult=String((error as any).code);}}
      @Client() onMount(){(window as any).__desktopAcceptanceReady=true;if(import.meta.env.DEV)(window as any).__desktopDevelopmentTools=enableDevTools();}
      @Client() async runStream(){for await(const _ of rpc$(this.stream())){}}
      @Client() async runNative(){const result=await rpc$(this.native());this.nativeResult=result?[result.status,result.headers.get('X-Native-Test'),...new Uint8Array(await result.arrayBuffer())].join(','):'';}
      render(){return html\`<main><span id="count">\${this.count}</span><span id="owner">\${this.owner}</span><span id="native">\${this.nativeResult}</span><span id="configuration">\${this.configuration}</span><span id="native-html">\${this.htmlResult}</span><span id="cancel-result">\${this.cancelResult}</span>
        <button @click="\${()=>this.increment()}">Increment</button><button @click="\${()=>this.runStream()}">Stream</button><button @click="\${()=>this.runNative()}">Native</button><button @click="\${()=>this.runHtml()}">Native HTML</button><button @click="\${()=>this.runCancellation()}">Start cancellation</button></main>\`;}
    }
  `,
  );
}

async function rendererFetch(page, url, init = {}) {
  return page.evaluate(
    async ({ url, init }) => {
      const response = await fetch(url, { ...init, cache: 'no-store' });
      return { status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers) };
    },
    { url, init },
  );
}

/**
 * Like Cloudflare and Node, only hashed build output under /assets/ is served
 * before the application. public/ files pass global and page policies first,
 * and missing files reach the framework's 404 handling. In development, Vite
 * answers its client and modules first instead of hashed build output.
 */
async function verifyDesktopStaticFiles(page, root, { development = false } = {}) {
  const denied = await rendererFetch(page, '/vault/record.txt');
  expect(denied).toMatchObject({ status: 403, body: 'vault denied' });
  const record = await rendererFetch(page, '/vault/record.txt', { headers: { 'x-vault': 'open' } });
  expect(record).toMatchObject({ status: 200, body: 'vault static body' });
  expect(record.headers).toMatchObject({ 'x-vault-policy': 'ran', 'x-desktop-pipeline': 'ran' });
  const missingRecord = await rendererFetch(page, '/vault/missing.txt', { headers: { 'x-vault': 'open' } });
  expect(missingRecord.status).toBe(404);
  expect(await rendererFetch(page, '/guarded/record.txt')).toMatchObject({ status: 401, body: 'global denied' });
  expect(await rendererFetch(page, '/guarded/record.txt', { headers: { 'x-role': 'admin' } }))
    .toMatchObject({ status: 200, body: 'guarded static body' });
  const missingAsset = await rendererFetch(page, '/assets/missing.00000000.js');
  expect(missingAsset.status).toBe(404);
  expect(missingAsset.headers['x-desktop-pipeline']).toBe('ran');
  if (development) {
    const client = await rendererFetch(page, '/@vite/client');
    expect(client.status).toBe(200);
    expect(client.headers['x-desktop-pipeline']).toBeUndefined();
    return;
  }
  expect(record.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-manifest.json'), 'utf8'));
  const clientFile = manifest['src/client/entry-client.ts'].file;
  expect(clientFile).toMatch(/^assets\/entry-client\.[\w-]{8,}\.js$/);
  const asset = await rendererFetch(page, `/${clientFile}`);
  expect(asset.status).toBe(200);
  expect(asset.body.length).toBeGreaterThan(0);
  expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(asset.headers['x-desktop-pipeline']).toBeUndefined();
}

export async function verifyDesktopRuntimeApplication(root, { executablePath, packaged = false } = {}) {
  const require = createRequire(path.join(root, 'package.json'));
  const executable = executablePath ?? require('electron');
  const profile = path.join(root, packaged ? '.desktop-packaged-profile' : '.desktop-acceptance-profile');
  await fs.mkdir(profile, { recursive: true });
  let helper;
  try {
    helper = await fs.stat(path.join(path.dirname(executable), 'chrome-sandbox'));
  } catch {}
  const fallback = process.platform === 'linux' && !(helper?.uid === 0 && (helper.mode & 0o4000) !== 0);
  // This only exercises an uninstalled test executable. OS sandbox acceptance
  // must use the installed native-host package, which configures its helper.
  const flags = [
    ...(fallback ? ['--no-sandbox'] : []),
    ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
    `--user-data-dir=${profile}`,
  ];
  const launch = () =>
    _electron.launch({
      executablePath: executable,
      args: [...flags, ...(packaged ? [] : [path.join(root, 'dist/desktop/index.js')])],
      cwd: path.dirname(root),
      chromiumSandbox: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        NODE_ENV: 'production',
        COSSACK_DESKTOP_DEBUG: '1',
      },
      timeout: 30000,
    });
  const application = await launch();
  let output = '';
  application.process().stdout?.on('data', (data) => {
    output += data;
  });
  application.process().stderr?.on('data', (data) => {
    output += data;
  });
  try {
    const page = await application.firstWindow({ timeout: 15000 });
    page.on('response', (response) => {
      if (response.status() >= 400)
        void response
          .text()
          .then((body) => {
            output += '\nFAILED_RESPONSE=' + response.url() + ' ' + body;
          })
          .catch(() => {});
    });
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      output += '\n' + error.stack;
    });
    page.on('console', (message) => {
      if (message.type() === 'error') output += '\n' + message.text();
    });
    await expect(page.locator('#count')).toHaveText('0');
    await page.waitForFunction(() => window.__desktopAcceptanceReady, {}, { timeout: 15000 });
    expect(page.url()).toMatch(/^cossack:\/\/app\//);
    expect(await page.evaluate(() => ({ require: typeof require, process: typeof process }))).toEqual({
      require: 'undefined',
      process: 'undefined',
    });
    const metadata = await application.evaluate(({ app, BrowserWindow }) => ({
      profile: app.getPath('userData'),
      version: process.versions.electron,
      id: BrowserWindow.getAllWindows()[0].id,
      preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    }));
    expect(metadata.profile).toBe(profile);
    expect(metadata.version).toMatch(/^\d+\./);
    expect(metadata.preferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    });
    expect(metadata.preferences.preload).toBeFalsy();
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await expect(page.locator('#count')).toHaveText('1');
    await expect(page.locator('#owner')).toHaveText(String(metadata.id));
    await page.getByRole('button', { name: 'Stream', exact: true }).click();
    await expect(page.locator('#count')).toHaveText('3');
    await page.getByRole('button', { name: 'Native', exact: true }).click();
    await expect(page.locator('#native')).toHaveText('201,kept,0,255,128');
    expect(await fs.readFile(path.join(profile, 'acceptance-count.txt'), 'utf8')).toBe('3');
    expect(errors).toEqual([]);
    await verifyDesktopStaticFiles(page, root);
    const [second, secondId] = await Promise.all([
      application.waitForEvent('window', { timeout: 15000 }),
      application.evaluate(
        (_electron, id) =>
          globalThis.__desktopAcceptanceApplication.createWindow({
            path: `/?__cossack_window=${id}`,
          }).id,
        metadata.id,
      ),
    ]);
    await second.waitForFunction(() => window.__desktopAcceptanceReady, {}, { timeout: 15000 });
    await second.getByRole('button', { name: 'Increment', exact: true }).click();
    await expect(second.locator('#count')).toHaveText('4');
    await expect(second.locator('#owner')).toHaveText(String(secondId));
    await second.goto('cossack://app/');
    await second.waitForFunction(() => window.__desktopAcceptanceReady, {}, { timeout: 15000 });
    await second.getByRole('button', { name: 'Increment', exact: true }).click();
    await expect(second.locator('#count')).toHaveText('5');
    await expect(second.locator('#owner')).toHaveText(String(secondId));

    // Foreign and opaque-origin frames share the managed window's session.
    // A simple POST has no preflight; failure must precede the filesystem write.
    const attack = `<html><body><script>(async()=>{
      for(const mode of ['cors','no-cors'])try{await fetch('cossack://app/api/desktop-write',{method:'POST',mode,headers:{'content-type':'text/plain'},body:'attack'});}catch{}
      parent.postMessage('desktop-attack-complete','*');
    })();</script></body></html>`;
    const foreign = createServer((_request, response) => response.end(attack));
    await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
    try {
      for (const opaque of [false, true])
        await page.evaluate(
          async ({ url, html, opaque }) => {
            const frame = document.createElement('iframe');
            if (opaque) {
              frame.setAttribute('sandbox', 'allow-scripts');
              frame.srcdoc = html;
            } else frame.src = url;
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                window.removeEventListener('message', receive);
                frame.remove();
                reject(new Error('Foreign-frame acceptance timed out'));
              }, 10000);
              const receive = (event) => {
                if (event.source === frame.contentWindow && event.data === 'desktop-attack-complete') {
                  clearTimeout(timer);
                  window.removeEventListener('message', receive);
                  frame.remove();
                  resolve();
                }
              };
              window.addEventListener('message', receive);
              document.body.append(frame);
            });
          },
          { url: `http://127.0.0.1:${foreign.address().port}`, html: attack, opaque },
        );
      await expect(fs.access(path.join(profile, 'foreign-write.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      foreign.closeAllConnections();
      await new Promise((resolve) => foreign.close(resolve));
    }
  } catch (error) {
    throw new Error(`${error.stack}\nElectron output:\n${output}`);
  } finally {
    await application.close();
  }
  const restarted = await launch();
  try {
    await expect((await restarted.firstWindow({ timeout: 15000 })).locator('#count')).toHaveText('5');
  } finally {
    await restarted.close();
  }
}

export async function verifyDesktopDevelopmentApplication(
  root,
  { onRecorded = async () => {}, startupError = false, launcher = false, crash = false } = {},
) {
  const require = createRequire(path.join(root, 'package.json'));
  const executable = require('electron');
  const runtime = path.join(root, 'node_modules/@cossackframework/desktop/dist/development-runtime.js');
  const profile = path.join(root, '.desktop-development-profile');
  const sourceFile = path.join(root, 'src/pages/index.ts');
  const source = await fs.readFile(sourceFile, 'utf8');
  const entryFile = path.join(root, 'src/desktop/index.ts');
  const configFile = path.join(root, 'vite.config.ts');
  const envFile = path.join(root, '.env.desktop.local');
  const entrySource = await fs.readFile(entryFile, 'utf8');
  const configSource = await fs.readFile(configFile, 'utf8');
  const envSource = await fs.readFile(envFile, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (startupError) await fs.writeFile(sourceFile, source + '\nthis is deliberately invalid TypeScript');

  const application = launcher
    ? await launchDesktopDevelopmentCli(root, profile, { crash })
    : await _electron.launch({
        executablePath: executable,
        cwd: root,
        chromiumSandbox: true,
        args: [
          ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=x11'] : []),
          `--user-data-dir=${profile}`,
          runtime,
        ],
        env: { ...process.env, NODE_ENV: 'development', ELECTRON_RUN_AS_NODE: '', COSSACK_DESKTOP_DEBUG: '1' },
        timeout: 30000,
      });
  let output = application.initialOutput ?? '';
  application.process().stdout?.on('data', (data) => {
    output += data;
  });
  application.process().stderr?.on('data', (data) => {
    output += data;
  });
  try {
    if (startupError) {
      await expect.poll(() => output, { timeout: 30000 }).toContain('[PARSE_ERROR]');
      await fs.writeFile(sourceFile, source);
    }
    const page = await application.firstWindow({ timeout: 30000 });
    page.on('pageerror', (error) => {
      output += '\n' + error.stack;
    });
    page.on('console', (message) => {
      output += '\n' + message.text();
    });
    page.on('response', (response) => {
      if (response.url().includes('/crpc'))
        void response
          .text()
          .then((body) => {
            output += '\nRPC_RESPONSE=' + response.status() + ' ' + body;
          })
          .catch(() => {});
    });
    page.on('requestfailed', (request) => {
      output += '\nFAILED_REQUEST=' + request.url() + ' ' + JSON.stringify(request.failure());
    });
    await page.waitForFunction(() => window.__desktopDevelopmentTools, {}, { timeout: 30000 });
    await page.getByRole('button', { name: 'Record trace', exact: true }).click();
    // Vite sends native terminal evidence only to a connected page and never
    // replays it. The page can become interactive before its Vite socket
    // opens, so wait for the bridge's first live record, which it sends over
    // that socket, before any native call.
    const recordFile = path.join(
      root,
      '.cossack/development-traces',
      (await page.evaluate(() => window.__desktopDevelopmentTools.snapshot().sessionId)) + '.json',
    );
    await expect
      .poll(
        () =>
          fs.access(recordFile).then(
            () => true,
            () => false,
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await expect(page.locator('#count')).toHaveText('1');
    await page.getByRole('button', { name: 'Stream', exact: true }).click();
    await expect(page.locator('#count')).toHaveText('3');
    await page.getByRole('button', { name: 'Native', exact: true }).click();
    await expect(page.locator('#native')).toHaveText('201,kept,0,255,128');
    await page.getByRole('button', { name: 'Native HTML', exact: true }).click();
    await expect(page.locator('#native-html')).toHaveText('<p>Native HTML remains opaque</p>');
    await page.getByRole('button', { name: 'Start cancellation', exact: true }).click();
    await expect
      .poll(() =>
        fs.readFile(path.join(profile, 'cancel-started.txt'), 'utf8').catch((error) => {
          if (error.code === 'ENOENT') return '';
          throw error;
        }),
      )
      .toBe('started');
    await page.evaluate(async () => {
      await window.__desktopPendingCall.cancel();
      await window.__desktopPendingCall.cancel();
    });
    await expect(page.locator('#cancel-result')).toHaveText('COSSACK_RPC_CANCELLED');
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__desktopDevelopmentTools.snapshot().events.filter((event) => event.kind === 'server-native')
                .length,
          ),
        { timeout: 10000 },
      )
      .toBe(2);
    await page.getByRole('button', { name: 'Stop trace', exact: true }).click();
    const snapshot = await page.evaluate(() => window.__desktopDevelopmentTools.snapshot());
    expect(snapshot.events.filter((event) => event.kind === 'rpc' && event.phase === 'start')).toHaveLength(5);
    expect(
      snapshot.events.filter(
        (event) => event.kind === 'rpc' && event.phase === 'finish' && event.outcome === 'cancelled',
      ),
    ).toHaveLength(1);
    for (const call of snapshot.events.filter((event) => event.kind === 'rpc' && event.phase === 'start')) {
      const events = snapshot.events.filter((event) => event.callId === call.callId);
      expect(events.filter((event) => event.kind === 'rpc' && event.phase === 'finish')).toHaveLength(1);
      if (events.some((event) => event.kind === 'rpc' && event.phase === 'finish' && event.outcome === 'cancelled'))
        continue;
      const dispatch = events.find((event) => event.kind === 'server-rpc');
      expect(dispatch).toMatchObject({ requestId: call.requestId, invokedAt: expect.any(Number) });
      if (dispatch.result === 'stream' || dispatch.result === 'native')
        expect(events.find((event) => event.kind === `server-${dispatch.result}`)).toMatchObject({
          requestId: call.requestId,
          dispatchId: dispatch.dispatchId,
          outcome: 'succeeded',
          cleanup: 'completed',
        });
    }
    expect(recordFile).toBe(path.join(root, '.cossack/development-traces', snapshot.sessionId + '.json'));
    let record;
    await expect
      .poll(
        async () => {
          try {
            record = JSON.parse(await fs.readFile(recordFile, 'utf8'));
            return record.snapshot.collecting;
          } catch (error) {
            if (error.code === 'ENOENT') return true;
            throw error;
          }
        },
        { timeout: 10000 },
      )
      .toBe(false);
    expect(record.snapshot.events).toEqual(snapshot.events);
    for (const value of ['acceptance-count.txt', 'increment', 'nativeResult'])
      expect(JSON.stringify(record)).not.toContain(value);
    await onRecorded({ snapshot, recorded: record });
    await verifyDesktopStaticFiles(page, root, { development: true });

    const updated = replaceOnce(
      replaceOnce(source, 'this.count++;this.owner', 'this.count+=2;this.owner'),
      '<main>',
      '<main><p id="development-reload">Source reloaded</p>',
    );
    await fs.writeFile(sourceFile, updated);
    await expect(page.locator('#development-reload')).toHaveText('Source reloaded', { timeout: 15000 });
    await page.waitForFunction(() => window.__desktopDevelopmentTools, {}, { timeout: 15000 });
    await expect(page.locator('#count')).toHaveText('3');
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await expect(page.locator('#count')).toHaveText('5');
    output = '';
    await fs.writeFile(sourceFile, updated + '\nthis is deliberately invalid TypeScript');
    await expect.poll(() => output, { timeout: 15000 }).toContain('[desktop]');
    await page.reload();
    await expect(page.locator('#cossack-development-error')).toBeVisible();
    await fs.writeFile(sourceFile, updated);
    await expect.poll(() => page.locator('#count').textContent(), { timeout: 15000 }).toBe('5');
    await page.waitForFunction(() => window.__desktopDevelopmentTools, {}, { timeout: 15000 });
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await expect(page.locator('#count')).toHaveText('7');
    if (launcher) {
      const assertRestart = async (change, expected) => {
        await application.restartAfter(change);
        const window = await application.firstWindow();
        await expect(window.locator('#count')).toHaveText('7');
        await expect(window.locator('#configuration')).toHaveText(expected);
        await window.waitForFunction(() => window.__desktopDevelopmentTools);
      };
      // Each change must restart Electron and apply its own value: the root
      // .env file, then the Vite configuration (process variables override
      // .env values), then the bootstrap's createEnv, which runs last.
      await assertRestart(() => fs.writeFile(envFile, 'DESKTOP_RELOAD_ACCEPTANCE=environment\n'), 'environment');
      await assertRestart(
        () =>
          fs.writeFile(
            configFile,
            replaceOnce(
              configSource,
              'plugins: [',
              "plugins: [{name:'restart-acceptance',config:()=>{process.env.DESKTOP_RELOAD_ACCEPTANCE='configuration';}},",
            ),
          ),
        'configuration',
      );
      await assertRestart(
        () =>
          fs.writeFile(
            entryFile,
            replaceOnce(
              entrySource,
              'return { ...variables };',
              "return { ...variables, DESKTOP_RELOAD_ACCEPTANCE: 'bootstrap' };",
            ),
          ),
        'bootstrap',
      );
    }
  } catch (error) {
    throw new Error(`${error.stack}\nElectron output:\n${output}`);
  } finally {
    try {
      await application.close();
    } finally {
      await fs.writeFile(sourceFile, source);
      await fs.writeFile(entryFile, entrySource);
      await fs.writeFile(configFile, configSource);
      if (envSource === null) await fs.rm(envFile, { force: true });
      else await fs.writeFile(envFile, envSource);
    }
  }
}
