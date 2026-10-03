import { it, expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { html, renderToString, minifyHtml } from '../../renderer/dist/server.js';
import { component } from '../../renderer/dist/index.js';
import { DropdownMenu, ContextMenu } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('navigates native dropdown and context menus without trapping page focus', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-menus-'));
  let server,browser;
  const templateSource=`(dropdown={},context={})=>html\`<button id="before">Before</button><fieldset>\${component(DropdownMenu,{id:'actions',trigger:'Actions',items:[{label:'Edit'},{label:'Disabled',disabled:true},{label:'Delete'},{separator:true},{label:'Copy'}],...dropdown},html\`<button type="button" role="menuitem" tabindex="-1" aria-disabled="true" @click=\${()=>{window.slotActivations++;}}>Slot unavailable</button><a id="custom-link" role="menuitem" tabindex="-1" href="#destination">Custom link</a>\`)}</fieldset><button id="after" style="margin-left:500px">After</button>\${component(ContextMenu,{id:'context',menuLabel:'Document actions','aria-label':'Document',items:[{label:'Edit'},{label:'Disabled',disabled:true},{label:'Delete'},{label:'Copy'}],...context},html\`<input id="context-input" aria-label="Document text"><span id="surface">Context surface</span>\`)}<button id="last" style="margin-left:300px">Last</button>\``;
  const template=new Function('html','component','DropdownMenu','ContextMenu',`return (${templateSource})`)(html,component,DropdownMenu,ContextMenu);
  try {
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template(),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component,preventDefault} from '@cossackframework/renderer';
import {DropdownMenu as BaseDropdown,ContextMenu as BaseContext} from '@cossackframework/ui';
class DropdownMenu extends BaseDropdown {constructor(){super();window.dropdown=this;}}
class ContextMenu extends BaseContext {constructor(){super();window.context=this;}}
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#actions'),initialContext=container.querySelector('#context');
let dropdown={},context={};window.events=[];window.slotActivations=0;window.veto=false;window.keep=false;
const items=()=>['Edit','Disabled','Delete','Copy'].map(label=>({label,disabled:label==='Disabled',onClick:event=>{window.events.push([label,event.currentTarget.tagName]);if(window.keep)event.preventDefault();}}));
function current(props){return {items:items(),...props,menuProps:{'@beforetoggle':event=>{if(window.veto&&event.newState==='open')event.preventDefault();},'@keydown':event=>{window.events.push(['key',event.currentTarget.id]);},...props.menuProps}};}
function draw(){render(template(current(dropdown),current(context)),container);}
window.update=(nextDropdown,nextContext)=>{dropdown={...dropdown,...nextDropdown};context={...context,...nextContext};draw();};
hydrate(template(current(dropdown),current(context)),container);window.retained=initial===container.querySelector('#actions')&&initialContext===container.querySelector('#context');
window.stopKeys=()=>window.update({'@keydown':preventDefault(()=>{})},{});
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=()=>{window.unmount();dropdown={};context={};draw();};
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
    browser = await chromium.launch({ headless: true });
    const url = `http://127.0.0.1:${server.address().port}`;







    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const trigger=page.locator('#actions'),menu=page.getByRole('menu',{name:'Actions',exact:true}),context=page.getByRole('menu',{name:'Document actions'});
    const item=name=>menu.getByRole('menuitem',{name,exact:true});
    await trigger.focus();await page.keyboard.press('Enter');await browserExpect(item('Edit')).toBeFocused();await browserExpect(trigger).toHaveAttribute('aria-expanded','true');
    await page.keyboard.press('ArrowDown');await browserExpect(item('Disabled')).toBeFocused();await browserExpect(item('Disabled')).toHaveAttribute('aria-disabled','true');
    await page.keyboard.press('Enter');await browserExpect(menu).toBeVisible();expect(await page.evaluate(()=>window.events.some(e=>e[0]==='Disabled'))).toBe(false);
    await page.keyboard.press('ArrowDown');await browserExpect(item('Delete')).toBeFocused();await page.keyboard.press('Home');await browserExpect(item('Edit')).toBeFocused();
    await page.keyboard.press('End');await browserExpect(item('Custom link')).toBeFocused();await page.keyboard.press('ArrowDown');await browserExpect(item('Edit')).toBeFocused();
    await page.keyboard.press('c');await browserExpect(item('Copy')).toBeFocused();await page.keyboard.press('c');await browserExpect(item('Custom link')).toBeFocused();
    await page.keyboard.press('Escape');await browserExpect(menu).not.toBeVisible();await browserExpect(trigger).toBeFocused();
    await page.keyboard.press('ArrowUp');await browserExpect(item('Custom link')).toBeFocused();await page.keyboard.press('Tab');await browserExpect(page.locator('#after')).toBeFocused();await browserExpect(menu).not.toBeVisible();
    await trigger.focus();await page.keyboard.press('ArrowDown');await browserExpect(item('Edit')).toBeFocused();await page.keyboard.press('Shift+Tab');await browserExpect(page.locator('#before')).toBeFocused();
    await trigger.click();await item('Delete').click();await browserExpect(menu).not.toBeVisible();await browserExpect(trigger).toBeFocused();expect(await page.evaluate(()=>window.events.filter(e=>e[0]==='Delete'))).toEqual([['Delete','BUTTON']]);
    await page.evaluate(()=>{window.keep=true;});await trigger.click();await item('Edit').click();await browserExpect(menu).toBeVisible();await page.evaluate(()=>{window.keep=false;});
    await page.locator('#after').click();await browserExpect(menu).not.toBeVisible();await browserExpect(page.locator('#after')).toBeFocused();
    await page.evaluate(()=>{window.veto=true;});await trigger.click();await browserExpect(menu).not.toBeVisible();await page.evaluate(()=>{window.veto=false;});
    await page.evaluate(()=>window.dropdown.showMenu());await browserExpect(item('Edit')).toBeFocused();await page.locator('fieldset').evaluate(el=>{el.disabled=true;});await browserExpect(menu).not.toBeVisible();
    await page.evaluate(()=>window.dropdown.showMenu());await browserExpect(menu).not.toBeVisible();await page.locator('fieldset').evaluate(el=>{el.disabled=false;});
    await page.locator('#context-input').focus();await page.keyboard.press('Shift+F10');await browserExpect(context.getByRole('menuitem',{name:'Edit',exact:true})).toBeFocused();
    await page.keyboard.press('ArrowDown');await browserExpect(context.getByRole('menuitem',{name:'Disabled'})).toBeFocused();await page.keyboard.press('Enter');await browserExpect(context).toBeVisible();
    await page.keyboard.press('Escape');await browserExpect(context).not.toBeVisible();await browserExpect(page.locator('#context-input')).toBeFocused();
    await page.keyboard.press('ContextMenu');await browserExpect(context).toBeVisible();await page.keyboard.press('End');await browserExpect(context.getByRole('menuitem',{name:'Copy'})).toBeFocused();
    await page.keyboard.press('Enter');await browserExpect(context).not.toBeVisible();await browserExpect(page.locator('#context-input')).toBeFocused();
    await page.locator('#surface').click({button:'right'});await browserExpect(context).toBeVisible();await browserExpect(context.getByRole('menuitem',{name:'Edit',exact:true})).toBeFocused();
    await page.locator('#last').click();await browserExpect(context).not.toBeVisible();await browserExpect(page.locator('#last')).toBeFocused();
    await page.locator('#context').focus();await page.keyboard.press('Shift+F10');await page.keyboard.press('Tab');await browserExpect(context).not.toBeVisible();await browserExpect(page.locator('#context-input')).toBeFocused();
    await page.evaluate(()=>window.update({}, {disabled:true}));await page.locator('#surface').click({button:'right'});await browserExpect(context).not.toBeVisible();
    await page.evaluate(()=>window.update({}, {disabled:false}));await page.locator('#surface').click({button:'right'});await browserExpect(context).toBeVisible();
    await page.evaluate(()=>document.dispatchEvent(new Event('scroll')));await browserExpect(context).not.toBeVisible();
    await page.evaluate(()=>window.dropdown.showMenu());await browserExpect(menu).toBeVisible();
    await item('Slot unavailable').focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.slotActivations)).toBe(0);await browserExpect(menu).toBeVisible();
    await item('Edit').focus();await page.evaluate(()=>window.update({items:[]},{}));await browserExpect(item('Slot unavailable')).toBeFocused();
    await page.evaluate(()=>window.dropdown.closeMenu());
    await page.evaluate(()=>window.update({items:[{label:'Open dialog',onClick:()=>{const modal=document.createElement('dialog');modal.id='confirmation';modal.innerHTML='<input autofocus aria-label="Confirm">';document.body.append(modal);modal.showModal();}}]},{}));
    await page.evaluate(()=>window.dropdown.showMenu());await item('Open dialog').click();await browserExpect(page.getByLabel('Confirm')).toBeFocused();await browserExpect(menu).not.toBeVisible();
    await page.locator('#confirmation').evaluate(el=>{el.close();el.remove();});
    await page.evaluate(()=>window.update({}, {menuProps:{style:'width:2000px;height:2000px;'}}));await page.locator('#context').focus();await page.keyboard.press('Shift+F10');
    await browserExpect.poll(()=>context.evaluate(el=>el.offsetWidth)).toBe(1264);await browserExpect.poll(()=>context.evaluate(el=>el.offsetHeight)).toBe(704);
    const bounds=await context.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(7);expect(bounds.y).toBeGreaterThanOrEqual(7);
    await context.evaluate(el=>el.dispatchEvent(new Event('scroll')));await browserExpect(context).toBeVisible();
    await page.evaluate(()=>document.dispatchEvent(new Event('scroll')));await browserExpect(context).not.toBeVisible();
    await page.evaluate(()=>{window.fresh();window.unmount();});

    await page.evaluate(()=>{window.dropdown.showMenu();window.context.hide();window.dispatchEvent(new Event('resize'));});
    await page.evaluate(()=>window.fresh());await trigger.click();await browserExpect(item('Edit')).toBeFocused();
    for(const side of ['top','bottom','left','right']) {
      await page.evaluate(side=>window.update({side,align:'end',style:'position:fixed;left:600px;top:350px;width:100px;',menuProps:{style:'width:200px;height:120px;'}},{}),side);
      await browserExpect(menu).toHaveAttribute('data-side',side);
      await browserExpect.poll(()=>menu.evaluate((el,side)=>{const m=el.getBoundingClientRect(),t=document.querySelector('#actions').getBoundingClientRect();return Math.abs(side==='top'?t.top-m.bottom-8:side==='bottom'?m.top-t.bottom-8:side==='left'?t.left-m.right-8:m.left-t.right-8);},side)).toBeLessThan(2);
    }
    await page.evaluate(()=>window.dropdown.closeMenu());await page.evaluate(()=>window.stopKeys());await trigger.focus();await page.keyboard.press('ArrowDown');await browserExpect(menu).not.toBeVisible();
    await page.evaluate(()=>window.update({'@keydown':undefined},{}));await page.keyboard.press('ArrowDown');await browserExpect(item('Edit')).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
