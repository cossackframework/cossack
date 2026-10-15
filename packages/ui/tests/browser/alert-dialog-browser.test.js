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
import { AlertDialog } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves alert dialog naming, safe initial focus and caller-owned confirmation', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-alert-'));
  let server,browser;
  const templateSource=`(Control,props={})=>html\`<button id="outside">Outside</button>\${component(Control,{id:'dialog',title:'Delete row?',description:'Cannot undo.',...props})}\``;
  const template=new Function('html','component',`return (${templateSource})`)(html,component);
  try {
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template(AlertDialog,{defaultOpen:true}),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {AlertDialog as BaseAlertDialog} from '@cossackframework/ui';
class AlertDialog extends BaseAlertDialog {constructor(){super();window.alert=this;}}
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#dialog');
let Control=AlertDialog,props={defaultOpen:true};window.actions=[];window.events=[];window.accept=false;window.veto=false;
const callbacks={onAction:event=>window.actions.push(event.currentTarget.tagName),onOpenChange:(open,event)=>{window.events.push(['close',event.currentTarget.id,event.currentTarget.returnValue]);if(window.accept){props.open=false;draw();}},'@close':event=>window.events.push(['native',event.currentTarget.id]),'@cancel':event=>{window.events.push(['cancel',event.currentTarget.id]);if(window.veto)event.preventDefault();}};
function draw(){render(template(Control,{...props,...callbacks}),container);}
window.update=next=>{props={...props,...next};draw();};
hydrate(template(Control,{...props,...callbacks}),container);window.retained=initial===container.querySelector('#dialog');
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=(next={})=>{window.unmount();props=next;window.events=[];window.actions=[];draw();};
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
    const dialog=page.locator('#dialog'),cancel=page.getByRole('button',{name:'Cancel',exact:true}),confirm=page.getByRole('button',{name:'Confirm',exact:true});
    await browserExpect(dialog).toHaveRole('alertdialog');await browserExpect(dialog).toHaveAccessibleName('Delete row?');await browserExpect(dialog).toHaveAccessibleDescription('Cannot undo.');await browserExpect(cancel).toBeFocused();
    expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
    await page.locator('#outside').evaluate(el=>el.focus());await browserExpect(page.locator('#outside')).not.toBeFocused();
    await page.keyboard.press('Tab');await browserExpect(confirm).toBeFocused();await page.keyboard.press('Shift+Tab');await browserExpect(cancel).toBeFocused();
    await page.mouse.click(2,2);expect(await dialog.evaluate(el=>el.open)).toBe(true);
    await confirm.click();expect(await page.evaluate(()=>window.actions)).toEqual(['BUTTON']);expect(await dialog.evaluate(el=>el.open)).toBe(true);
    await page.evaluate(()=>window.update({actionDisabled:true}));await browserExpect(confirm).toBeDisabled();await confirm.evaluate(el=>el.click());expect(await page.evaluate(()=>window.actions.length)).toBe(1);
    await cancel.click();await browserExpect(dialog).not.toBeVisible();await page.waitForFunction(()=>window.events.filter(e=>e[0]==='close').length===1);
    await page.evaluate(()=>window.update({'data-rerender':'yes'}));await browserExpect(dialog).not.toBeVisible();
    await page.locator('#outside').focus();await page.evaluate(()=>window.update({open:true,actionDisabled:false}));await browserExpect(cancel).toBeFocused();
    await page.evaluate(()=>{window.veto=true;});await page.keyboard.press('Escape');expect(await dialog.evaluate(el=>el.open)).toBe(true);
    await page.evaluate(()=>{window.veto=false;window.update({closeOnEscape:false});});await page.keyboard.press('Escape');expect(await dialog.evaluate(el=>el.open)).toBe(true);
    await page.evaluate(()=>window.update({closeOnEscape:true}));await cancel.click();await page.waitForFunction(()=>window.events.filter(e=>e[0]==='close').length===2);await browserExpect(dialog).toBeVisible(); // Rejected controlled dismissal reopens.
    await page.evaluate(()=>{window.accept=true;});await page.keyboard.press('Escape');await browserExpect(dialog).not.toBeVisible();await browserExpect(page.locator('#outside')).toBeFocused();
    const count=await page.evaluate(()=>window.events.filter(e=>e[0]==='close').length);
    await page.evaluate(()=>window.update({open:true}));await browserExpect(dialog).toBeVisible();await page.evaluate(()=>window.update({open:false}));await browserExpect(dialog).not.toBeVisible();
    await page.waitForTimeout(100);expect(await page.evaluate(()=>window.events.filter(e=>e[0]==='close').length)).toBe(count);
    await page.evaluate(()=>window.fresh({defaultOpen:true}));await browserExpect(dialog).toBeVisible();await page.evaluate(()=>window.alert.close());await browserExpect(dialog).not.toBeVisible();
    await page.evaluate(()=>{window.fresh({defaultOpen:true});window.unmount();});await page.waitForTimeout(100);expect(await page.locator(':modal').count()).toBe(0);
    await page.evaluate(()=>{window.alert.close();window.fresh({defaultOpen:true});});await browserExpect(dialog).toBeVisible();await browserExpect(cancel).toBeFocused();await page.evaluate(()=>window.unmount());expect(await page.locator(':modal').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
