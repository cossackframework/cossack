import { launchDesktopDevelopmentCli } from './desktop-development-driver.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { _electron, expect } from '@playwright/test';

export async function writeDesktopRuntimeAcceptance(root) {
  const entryFile = path.join(root, 'src/desktop/index.ts');
  const entry = await fs.readFile(entryFile, 'utf8');
  // Test-only main-process reference to the public result; never exposed to renderers.
  await fs.writeFile(
    entryFile,
    entry.replace(
      '  configureDesktopClose({',
      '  (globalThis as any).__desktopAcceptanceApplication = desktop;\n  configureDesktopClose({',
    ),
  );
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
    const recordFile = path.join(root, '.cossack/development-traces', snapshot.sessionId + '.json');
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

    const updated = source
      .replace('this.count++;this.owner', 'this.count+=2;this.owner')
      .replace('<main>', '<main><p id="development-reload">Source reloaded</p>');
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
      await assertRestart(() => fs.writeFile(envFile, 'DESKTOP_RELOAD_ACCEPTANCE=environment\n'), 'environment');
      await assertRestart(
        () =>
          fs.writeFile(
            configFile,
            configSource.replace(
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
            entrySource.replace('{ ...process.env }', "{ ...process.env, DESKTOP_RELOAD_ACCEPTANCE:'bootstrap' }"),
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
