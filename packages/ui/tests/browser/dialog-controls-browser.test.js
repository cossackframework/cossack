import { launchBrowser, tailwind } from './helpers.js';
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { html, renderToString, minifyHtml } from '../../../renderer/dist/server.js';
import { component } from '../../../renderer/dist/index.js';
import { Modal, Sheet, Drawer } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves native modal focus, dismissal, events and controlled state', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-dialogs-'));
  let server,browser;
  const templateSource=`(Control,props={})=>html\`<button id="outside">Outside</button>\${component(Control,{id:'dialog','aria-label':'Example',...props},html\`<form method="dialog"><input aria-label="Name" autofocus required><button value="saved">Save</button></form>\`)}\``;
  const template=new Function('html','component',`return (${templateSource})`)(html,component);
  try {
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template(Modal,{defaultOpen:true}),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Modal,Sheet,Drawer} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#dialog');
let Control=Modal,props={defaultOpen:true};window.events=[];window.accept=false;window.veto=false;
const callbacks={onClose:event=>{window.events.push(['close',event.currentTarget.id,event.currentTarget.returnValue]);if(window.accept){props.open=false;draw();}},'@close':event=>window.events.push(['native',event.currentTarget.id]),'@cancel':event=>{window.events.push(['cancel',event.currentTarget.id]);if(window.veto)event.preventDefault();}};
function draw(){render(template(Control,{...props,...callbacks}),container);}
window.update=next=>{props={...props,...next};draw();};
hydrate(template(Control,{...props,...callbacks}),container);window.retained=initial===container.querySelector('#dialog');
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=(name,next={})=>{window.unmount();Control={Modal,Sheet,Drawer}[name];props=next;window.events=[];draw();};
`);
    const built = await build({ root, configFile: false, logLevel: 'silent', plugins:[tailwind()], build: { outDir: 'dist', emptyOutDir: true } });
    const chunks = (Array.isArray(built) ? built : [built]).flatMap(result => result.output).filter(chunk => chunk.type === 'chunk');
    const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
    expect(modules.some(id => id.includes('/parse5/') || id.endsWith('/ssr-form-values.js'))).toBe(false);
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await fs.readFile(file)); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await launchBrowser();
    const url = `http://127.0.0.1:${server.address().port}`;





    const noJS=await browser.newContext({javaScriptEnabled:false});const staticPage=await noJS.newPage();await staticPage.goto(url);await browserExpect(staticPage.locator('#dialog')).not.toHaveAttribute('open');await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
    await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const dialog=page.locator('#dialog');
    await page.waitForFunction(()=>document.querySelector('#dialog').matches(':modal'));
    for(const name of ['Modal','Sheet','Drawer']) {
      await page.evaluate(name=>{window.accept=false;window.fresh(name);},name);
      await page.locator('#outside').focus();await page.evaluate(()=>window.update({open:true}));
      await browserExpect(dialog).toBeVisible();await browserExpect(page.getByLabel('Name')).toBeFocused();
      expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
      await page.locator('#outside').evaluate(el=>el.focus());await browserExpect(page.locator('#outside')).not.toBeFocused();
      await page.keyboard.press('Shift+Tab');await browserExpect(page.locator('#outside')).not.toBeFocused();
      await page.getByRole('button',{name:'Save',exact:true}).click();expect(await dialog.evaluate(el=>el.open)).toBe(true);
      await page.evaluate(()=>{window.veto=true;});await page.keyboard.press('Escape');expect(await dialog.evaluate(el=>el.open)).toBe(true);
      await page.evaluate(()=>{window.veto=false;window.update({closeOnEscape:false});});await page.keyboard.press('Escape');expect(await dialog.evaluate(el=>el.open)).toBe(true);
      await page.evaluate(()=>window.update({closeOnEscape:true}));await page.keyboard.press('Escape');
      await page.waitForFunction(()=>window.events.some(e=>e[0]==='close'));await browserExpect(dialog).toBeVisible();
      await page.waitForFunction(()=>document.querySelector('#dialog').matches(':modal')); // Rejected controlled close reopens.
      await page.evaluate(()=>{window.accept=true;});await page.getByLabel('Name').fill('Ada');await page.getByRole('button',{name:'Save',exact:true}).click();
      await browserExpect(dialog).not.toBeVisible();expect(await page.evaluate(()=>window.events.filter(e=>e[0]==='close').at(-1))).toEqual(['close','dialog','saved']);
      const count=await page.evaluate(()=>window.events.filter(e=>e[0]==='close').length);
      await page.evaluate(()=>window.update({open:true}));await browserExpect(dialog).toBeVisible();expect(await dialog.evaluate(el=>el.returnValue)).toBe('');
      await page.evaluate(()=>window.update({open:false}));await browserExpect(dialog).not.toBeVisible();
      expect(await page.evaluate(()=>window.events.filter(e=>e[0]==='close').length)).toBe(count);
      await page.evaluate(name=>{window.accept=false;window.fresh(name,{defaultOpen:true});},name);await browserExpect(dialog).toBeVisible();
      await page.keyboard.press('Escape');await browserExpect(dialog).not.toBeVisible();await page.evaluate(()=>window.update({'data-update':'yes'}));await browserExpect(dialog).not.toBeVisible();
      await page.evaluate(()=>window.update({open:true}));await browserExpect(dialog).toBeVisible();
      await page.evaluate(()=>{window.accept=true;window.update({closeOnBackdrop:false});});
      await page.mouse.click(2,2);expect(await dialog.evaluate(el=>el.open)).toBe(true);
      await page.evaluate(()=>window.update({closeOnBackdrop:true}));
      await dialog.evaluate(el=>el.click());expect(await dialog.evaluate(el=>el.open)).toBe(true);
      const panel=dialog.locator('[data-dialog-panel]');
      await panel.click({position:{x:10,y:10}});expect(await dialog.evaluate(el=>el.open)).toBe(true);
      await page.mouse.click(2,2);await browserExpect(dialog).not.toBeVisible();
      await page.locator('#outside').focus();await page.evaluate(()=>window.update({open:true}));await browserExpect(dialog).toBeVisible();
      await page.getByLabel('Name').evaluate(el=>{
        const nested=document.createElement('dialog');nested.id='nested';nested.innerHTML='<button autofocus>Nested</button>';el.closest('dialog').append(nested);nested.showModal();
      });
      await browserExpect(page.locator('#nested button')).toBeFocused();await page.keyboard.press('Escape');
      await browserExpect(page.locator('#nested')).not.toBeVisible();expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
      await page.locator('#nested').evaluate(el=>el.remove());
      await page.keyboard.press('Escape');await browserExpect(dialog).not.toBeVisible();await browserExpect(page.locator('#outside')).toBeFocused();
      await page.evaluate(()=>window.update({open:true}));await browserExpect(dialog).toBeVisible();
      const beforeRapid=await page.evaluate(()=>window.events.filter(e=>e[0]==='close').length);
      await page.evaluate(async()=>{window.update({open:false});await new Promise(resolve=>queueMicrotask(resolve));window.update({open:true});});
      await page.waitForFunction(()=>document.querySelector('#dialog').matches(':modal'));
      expect(await page.evaluate(()=>window.events.filter(e=>e[0]==='close').length)).toBe(beforeRapid);
      await page.evaluate(()=>window.unmount());expect(await page.locator(':modal').count()).toBe(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
