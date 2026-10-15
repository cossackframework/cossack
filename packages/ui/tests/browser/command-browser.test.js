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
import { Command } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('coordinates command shortcuts, modal focus and stable searchable results', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-command-'));
  let server,browser;
  const templateSource=`(Control,props={},second={})=>html\`<button id="outside">Outside</button>\${component(Control,{id:'command',label:'Navigate',items:[{id:'home',label:'Home'},{id:'locked',label:'Locked',disabled:true},{id:'settings',label:'Settings'},{id:'profile',label:'Profile'}],...props})}\${component(Control,{id:'second',label:'Second',items:[{id:'other',label:'Other'}],...second})}\``;
  const template=new Function('html','component',`return (${templateSource})`)(html,component);
  try {
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template(Command,{shortcut:true}),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Command as BaseCommand} from '@cossackframework/ui';
class Command extends BaseCommand {constructor(){super();(window.instances??=[]).push(this);}}
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#command');
let Control=Command,props={shortcut:true},second={};window.events=[];window.selections=[];window.accept=false;window.veto=false;
const callbacks={onSelect:id=>window.selections.push(id),onOpenChange:open=>{window.events.push(open);if(window.accept){props.open=open;draw();}},'@cancel':event=>{if(window.veto)event.preventDefault();}};
function draw(){render(template(Control,{...props,...callbacks},second),container);}
// Await native dialog close tasks and component rendering before another key.
window.settle=async()=>{
  await Promise.all(window.instances.map(instance=>instance.updateComplete));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  await Promise.all(window.instances.map(instance=>instance.updateComplete));
};
window.update=async next=>{props={...props,...next};draw();await window.settle();};
window.updateSecond=async next=>{second={...second,...next};draw();await window.settle();};
hydrate(template(Control,{...props,...callbacks},second),container);window.retained=initial===container.querySelector('#command');
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=(next={},other={})=>{window.unmount();props=next;second=other;window.events=[];window.selections=[];draw();};
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

    const noJS=await browser.newContext({javaScriptEnabled:false});const staticPage=await noJS.newPage();await staticPage.goto(url);await browserExpect(staticPage.locator('#command')).not.toHaveAttribute('open');await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
    await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const dialog=page.locator('#command'),input=dialog.getByRole('combobox'),second=page.locator('#second'),outside=page.locator('#outside');
    await outside.focus();await page.keyboard.press('Control+k');await browserExpect(dialog).toBeVisible();await browserExpect(second).not.toBeVisible();await browserExpect(input).toBeFocused();
    await browserExpect(dialog).toHaveAccessibleName('Navigate');await browserExpect(input).toHaveAccessibleName('Search commands');await outside.evaluate(el=>el.focus());await browserExpect(outside).not.toBeFocused();
    await browserExpect(input).toHaveAttribute('aria-activedescendant','command-option-home');await page.keyboard.press('ArrowDown');await browserExpect(input).toHaveAttribute('aria-activedescendant','command-option-settings');
    await page.evaluate(()=>window.update({items:[{id:'profile',label:'Profile'},{id:'settings',label:'Settings'},{id:'home',label:'Home'}]}));await browserExpect(input).toHaveAttribute('aria-activedescendant','command-option-settings');
    await page.evaluate(()=>window.update({items:[{id:'profile',label:'Profile'},{id:'home',label:'Home'}]}));await browserExpect(input).toHaveAttribute('aria-activedescendant','command-option-profile');
    await input.fill('nothing');await browserExpect(dialog.getByRole('status')).toHaveText('No results found.');await browserExpect(input).not.toHaveAttribute('aria-activedescendant');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.selections)).toEqual([]);
    await input.fill('HOME');await browserExpect(dialog.getByRole('option')).toHaveCount(1);await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});expect(await page.evaluate(()=>window.selections)).toEqual([]);await page.keyboard.press('Enter');await browserExpect(dialog).not.toBeVisible();expect(await page.evaluate(()=>window.selections)).toEqual(['home']);await browserExpect(outside).toBeFocused();
    await page.keyboard.press('Control+k');await browserExpect(input).toHaveValue('');await page.keyboard.press('Tab');await browserExpect(dialog.getByRole('button',{name:'Close commands'})).toBeFocused();await page.keyboard.press('Shift+Tab');await browserExpect(input).toBeFocused();
    await page.evaluate(()=>{window.veto=true;});await page.keyboard.press('Escape');await browserExpect(dialog).toBeVisible();await page.evaluate(()=>{window.veto=false;});await page.keyboard.press('Escape');await browserExpect(dialog).not.toBeVisible();
    await page.evaluate(()=>window.update({open:false}));await page.keyboard.press('Control+k');await browserExpect(dialog).not.toBeVisible();expect(await page.evaluate(()=>window.events.at(-1))).toBe(true);
    // A parent rejects a proposal by re-rendering its own value; until then the next shortcut builds on the proposal.
    await page.evaluate(()=>window.update({}));
    await page.evaluate(()=>{window.accept=true;});await page.keyboard.press('Control+k');await browserExpect(dialog).toBeVisible();await page.mouse.click(2,2);await browserExpect(dialog).not.toBeVisible();
    await page.evaluate(()=>window.update({open:true}));await browserExpect(dialog).toBeVisible();const beforeRejectedClose=await page.evaluate(()=>{window.accept=false;return window.events.length;});await page.keyboard.press('Escape');await page.waitForFunction(count=>window.events.length>count,beforeRejectedClose);expect(await page.evaluate(()=>window.events.at(-1))).toBe(false);await browserExpect(dialog).toBeVisible();await page.evaluate(()=>{window.accept=true;});await page.keyboard.press('Escape');
    // The native dialog can hide before its close callback accepts controlled state.
    await page.waitForFunction(()=>window.instances.find(instance=>instance.props.id==='command').props.open===false);
    await browserExpect(dialog).not.toBeVisible();
    await page.evaluate(()=>window.updateSecond({shortcut:true}));await outside.focus();await browserExpect(outside).toBeFocused();await page.keyboard.press('Control+k');await browserExpect(dialog).toBeVisible();await browserExpect(second).not.toBeVisible();await page.keyboard.press('Control+k');await browserExpect(dialog).not.toBeVisible();await browserExpect(second).not.toBeVisible();
    await page.evaluate(()=>window.update({shortcut:false}));await outside.focus();await browserExpect(outside).toBeFocused();await page.keyboard.press('Control+k');await browserExpect(second).toBeVisible();await browserExpect(dialog).not.toBeVisible();await page.keyboard.press('Escape');await browserExpect(second).not.toBeVisible();
    await page.evaluate(()=>{window.accept=false;window.fresh({defaultOpen:true});});await browserExpect(dialog).toBeVisible();await dialog.getByRole('option',{name:'Locked'}).click({force:true});expect(await page.evaluate(()=>window.selections)).toEqual([]);await dialog.getByRole('option',{name:'Settings'}).click();await browserExpect(dialog).not.toBeVisible();expect(await page.evaluate(()=>window.selections)).toEqual(['settings']);
    await page.evaluate(()=>{window.fresh({shortcut:true});window.unmount();});await page.keyboard.press('Control+k');expect(await page.locator(':modal').count()).toBe(0);
    await page.evaluate(()=>{window.fresh({shortcut:true});const foreign=document.createElement('dialog');foreign.id='foreign';foreign.innerHTML='<button>Other modal</button>';document.body.append(foreign);foreign.showModal();});await page.keyboard.press('Control+k');await browserExpect(dialog).not.toBeVisible();await browserExpect(page.locator('#foreign')).toBeVisible();await page.evaluate(()=>{document.querySelector('#foreign').close();document.querySelector('#foreign').remove();});await page.keyboard.press('Control+k');await browserExpect(dialog).toBeVisible();expect(await page.locator(':modal').count()).toBe(1);await page.evaluate(()=>window.unmount());expect(await page.locator(':modal').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
