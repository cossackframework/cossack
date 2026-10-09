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
import { Menubar } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('owns menubar identities, keyboard navigation, dismissal and dynamic focus', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-menubar-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<button id="before">Before</button><form><fieldset id="fields">\${component(Menubar,{id:'one',label:'Editor',...p})}\${component(Menubar,{id:'two',label:'Other editor',menus:[{value:'file',label:'File',items:[{label:'Other save'}]}]})}<button id="after" type="button">After</button></fieldset></form>\``;
  const template=new Function('html','component','Menubar',`return (${templateSource})`)(html,component,Menubar);
  const initial=[{value:'file"[]',label:'File',items:[{label:'Save'},{separator:true},{label:'Blocked',disabled:true},{label:'Search'}]},{value:'edit',label:'Edit',items:[{label:'Undo'},{label:'Redo'}]},{value:'help',label:'Help',disabled:true,items:[{label:'About'}]}];
  try {
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template({menus:initial}),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Menubar} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#one');
window.actions=[];window.veto=false;window.vetoAction=false;window.submits=0;
let menus=${JSON.stringify(initial)},props={};
function current(){return {...props,menus:menus.map(menu=>({...menu,items:menu.items.map(item=>item.separator?item:{...item,onClick:event=>{window.actions.push(item.label);window.actionTarget=event.currentTarget.tagName;if(window.vetoAction)event.preventDefault();}})})),'@keydown':event=>{window.rootTarget=event.currentTarget.id;if(window.veto)event.preventDefault();}};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};if(patch.menus)menus=patch.menus;draw();};
window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};menus=${JSON.stringify(initial)};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#one');
container.addEventListener('submit',event=>{event.preventDefault();window.submits++;});
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

    const noJS=await browser.newContext({javaScriptEnabled:false});const staticPage=await noJS.newPage();await staticPage.goto(url);
    await browserExpect(staticPage.getByRole('menubar',{name:'Editor',exact:true})).toBeVisible();
    expect(await staticPage.locator('#one [aria-controls]').evaluateAll(elements=>elements.every(el=>!!document.getElementById(el.getAttribute('aria-controls'))))).toBe(true);await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const bar=page.locator('#one'),file=bar.locator('button[aria-haspopup]').filter({hasText:'File'}),edit=bar.locator('button[aria-haspopup]').filter({hasText:'Edit'}),help=bar.locator('button[aria-haspopup]').filter({hasText:'Help'});
    const panel=bar.locator('[role="menu"]').first(),save=panel.getByRole('menuitem',{name:'Save',exact:true}),blocked=panel.getByRole('menuitem',{name:'Blocked'}),search=panel.getByRole('menuitem',{name:'Search'});
    await edit.hover();await browserExpect(edit).toHaveAttribute('aria-expanded','false');
    await page.locator('#before').focus();await page.keyboard.press('Tab');await browserExpect(file).toBeFocused();expect(await bar.locator('button[aria-haspopup][tabindex="0"]').count()).toBe(1);
    await page.evaluate(()=>window.veto=true);await page.keyboard.press('ArrowRight');await browserExpect(file).toBeFocused();expect(await page.evaluate(()=>window.rootTarget)).toBe('one');await page.evaluate(()=>window.veto=false);
    await page.keyboard.press('ArrowRight');await browserExpect(edit).toBeFocused();await page.keyboard.press('End');await browserExpect(help).toBeFocused();await page.keyboard.press('Enter');await browserExpect(help).toHaveAttribute('aria-expanded','false');await page.keyboard.press('Home');await browserExpect(file).toBeFocused();
    await page.keyboard.press('ArrowDown');await browserExpect(save).toBeFocused();await browserExpect(panel).toHaveAccessibleName('File');await browserExpect(file).toHaveAttribute('aria-expanded','true');
    await page.locator('#before').hover();await edit.hover();await browserExpect(bar.getByRole('menuitem',{name:'Undo',exact:true})).toBeFocused();await file.hover();await browserExpect(save).toBeFocused();
    await page.keyboard.press('ArrowDown');await browserExpect(blocked).toBeFocused();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.actions)).toEqual([]);await page.keyboard.press('s');await browserExpect(search).toBeFocused();await page.keyboard.press('Home');await browserExpect(save).toBeFocused();
    await page.evaluate(()=>window.vetoAction=true);await page.keyboard.press('Enter');await browserExpect(panel).toBeVisible();expect(await page.evaluate(()=>window.actionTarget)).toBe('BUTTON');await page.evaluate(()=>window.vetoAction=false);await page.keyboard.press('Enter');await browserExpect(file).toBeFocused();await browserExpect(file).toHaveAttribute('aria-expanded','false');
    await page.keyboard.press('ArrowUp');await browserExpect(search).toBeFocused();await page.keyboard.press('ArrowRight');await browserExpect(bar.getByRole('menuitem',{name:'Undo',exact:true})).toBeFocused();await browserExpect(file).toHaveAttribute('aria-expanded','false');
    await page.keyboard.press('Escape');await browserExpect(edit).toBeFocused();await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');await browserExpect(page.locator('#two button[aria-haspopup]')).toBeFocused();await browserExpect(edit).toHaveAttribute('aria-expanded','false');
    await page.keyboard.press('Enter');await browserExpect(page.locator('#two').getByRole('menuitem',{name:'Other save'})).toBeFocused();await browserExpect(bar.locator('[role="menu"]:popover-open')).toHaveCount(0);await page.locator('#after').click();await browserExpect(page.locator('#after')).toBeFocused();await browserExpect(page.locator('[role="menu"]:popover-open')).toHaveCount(0);
    await page.evaluate(()=>window.update({dir:'rtl'}));await file.focus();await page.keyboard.press('ArrowLeft');await browserExpect(edit).toBeFocused();await page.keyboard.press('ArrowRight');await browserExpect(file).toBeFocused();await page.keyboard.press('e');await browserExpect(edit).toBeFocused();
    await page.evaluate(()=>window.update({menus:[{value:'edit',label:'Edit',items:[{label:'Undo'},{label:'Redo'}]},{value:'file"[]',label:'File',items:[{label:'Save'}]}]}));await browserExpect(edit).toBeFocused();
    await page.keyboard.press('Enter');await browserExpect(bar.getByRole('menuitem',{name:'Undo',exact:true})).toBeFocused();
    await page.evaluate(()=>window.update({menus:[{value:'file"[]',label:'File',items:[{label:'Save'}]},{value:'edit',label:'Edit',items:[{label:'Undo'},{label:'Redo'}]}]}));await browserExpect(edit).toHaveAttribute('aria-expanded','true');await browserExpect(bar.getByRole('menuitem',{name:'Undo',exact:true})).toBeFocused();
    await page.keyboard.press('End');await browserExpect(bar.getByRole('menuitem',{name:'Redo',exact:true})).toBeFocused();await page.evaluate(()=>window.update({menus:[{value:'file"[]',label:'File',items:[{label:'Save'}]},{value:'edit',label:'Edit',items:[{label:'Undo'}]}]}));await browserExpect(bar.getByRole('menuitem',{name:'Undo',exact:true})).toBeFocused();
    await page.evaluate(()=>window.update({menus:[{value:'file"[]',label:'File',items:[{label:'Save'}]},{value:'edit',label:'Edit',items:[]}]}));await browserExpect(bar.getByRole('menu',{name:'Edit',exact:true})).toBeFocused();
    await page.evaluate(()=>window.update({menus:[{value:'file"[]',label:'File',items:[{label:'Save'}]}]}));await browserExpect(file).toBeFocused();
    await file.click();await page.locator('#fields').evaluate(el=>el.disabled=true);await browserExpect(file).toHaveAttribute('aria-expanded','false');await file.click({force:true});await browserExpect(file).toHaveAttribute('aria-expanded','false');await page.locator('#fields').evaluate(el=>el.disabled=false);
    await page.evaluate(()=>window.update({menus:[{value:'file"[]',label:'File',items:Array.from({length:50},(_,i)=>({label:'Action '+i}))}]}));await page.setViewportSize({width:360,height:280});await file.click();const bounds=await panel.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(361);expect(bounds.y+bounds.height).toBeLessThanOrEqual(281);
    await page.keyboard.press('End');await browserExpect(panel.getByRole('menuitem',{name:'Action 49',exact:true})).toBeFocused();await page.keyboard.press('Escape');await page.evaluate(()=>{window.update({label:'Updated editor'});window.unmount();window.dispatchEvent(new Event('resize'));});await page.evaluate(()=>window.fresh());
    await page.evaluate(()=>window.update({menus:[{value:'file"[]',label:'File',items:[{label:'Save'},{label:'Search'}],triggerProps:{'@click':event=>{event.preventDefault();window.triggerTarget=event.currentTarget.tagName;}},menuProps:{'@keydown':event=>{if(event.key==='ArrowDown'){event.preventDefault();window.panelTarget=event.currentTarget.tagName;}}}}]}));await file.click();await browserExpect(file).toHaveAttribute('aria-expanded','false');expect(await page.evaluate(()=>window.triggerTarget)).toBe('BUTTON');await file.focus();await page.keyboard.press('ArrowDown');await browserExpect(save).toBeFocused();await page.keyboard.press('ArrowDown');await browserExpect(save).toBeFocused();expect(await page.evaluate(()=>window.panelTarget)).toBe('DIV');
    await page.evaluate(()=>window.update({disabled:true}));await browserExpect(file).toHaveAttribute('aria-expanded','false');await file.focus();await page.keyboard.press('Enter');await browserExpect(file).toHaveAttribute('aria-expanded','false');
    await page.evaluate(()=>window.update({disabled:false,menus:[]}));await browserExpect(bar).toBeFocused();expect(await page.evaluate(()=>window.submits)).toBe(0);expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
