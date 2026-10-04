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
    import type {DesktopShell} from '@cossackframework/desktop';
    import {readFile,writeFile} from 'node:fs/promises';
    import path from 'node:path';
    @Page({transport:'http'}) export default class DesktopCheck extends Cossack {
      @State() count=0;
      @State() owner=0;
      @ClientState() nativeResult='';
      shell(){return this.env.COSSACK_DESKTOP as DesktopShell;}
      storage(){return path.join(this.shell().app.getPath('userData'),'acceptance-count.txt');}
      async init(){try{this.count=Number(await readFile(this.storage(),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
      @Server() async increment(){this.count++;this.owner=this.shell().window.id;await writeFile(this.storage(),String(this.count));}
      @Server() async *stream(){this.count++;yield this.count;this.count++;await writeFile(this.storage(),String(this.count));return this.count;}
      @Server() native(){return new Response(new Uint8Array([0,255,128]),{status:201,headers:{'X-Native-Test':'kept'}});}
      @Client() onMount(){(window as any).__desktopAcceptanceReady=true;}
      @Client() async runStream(){for await(const _ of rpc$(this.stream())){}}
      @Client() async runNative(){const result=await rpc$(this.native());this.nativeResult=result?[result.status,result.headers.get('X-Native-Test'),...new Uint8Array(await result.arrayBuffer())].join(','):'';}
      render(){return html\`<main><span id="count">\${this.count}</span><span id="owner">\${this.owner}</span><span id="native">\${this.nativeResult}</span>
        <button @click="\${()=>this.increment()}">Increment</button><button @click="\${()=>this.runStream()}">Stream</button><button @click="\${()=>this.runNative()}">Native</button></main>\`;}
    }
  `,
  );
}

export async function verifyDesktopRuntimeApplication(
  root,
  { executablePath, packaged = false } = {},
) {
  const require = createRequire(path.join(root, 'package.json'));
  const executable = executablePath ?? require('electron');
  const profile = path.join(
    root,
    packaged ? '.desktop-packaged-profile' : '.desktop-acceptance-profile',
  );
  await fs.mkdir(profile, { recursive: true });
  let helper;
  try {
    helper = await fs.stat(path.join(path.dirname(executable), 'chrome-sandbox'));
  } catch {}
  const fallback =
    process.platform === 'linux' && !(helper?.uid === 0 && (helper.mode & 0o4000) !== 0);
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
    expect(
      await page.evaluate(() => ({ require: typeof require, process: typeof process })),
    ).toEqual({ require: 'undefined', process: 'undefined' });
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
                if (
                  event.source === frame.contentWindow &&
                  event.data === 'desktop-attack-complete'
                ) {
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
    await expect((await restarted.firstWindow({ timeout: 15000 })).locator('#count')).toHaveText(
      '5',
    );
  } finally {
    await restarted.close();
  }
}
