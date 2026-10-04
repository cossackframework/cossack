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
import { NavigationMenu } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('preserves native navigation, hover focus, disclosure keyboard behavior and cleanup', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-navigation-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<input id="outside" value="Keep focus"><form><fieldset id="fields" style="display:flex;gap:48px;align-items:start">\${component(NavigationMenu,{id:'one',label:'Primary',...p})}\${component(NavigationMenu,{id:'two',label:'Secondary',sections:[{value:'products"[]',label:'Products',items:[{value:'other',label:'Other',href:'#other'}]}]})}<button id="after" type="button">After</button></fieldset></form><div id="core">Core destination</div><div id="ui">UI destination</div>\``;
  const template=new Function('html','component','NavigationMenu',`return (${templateSource})`)(html,component,NavigationMenu);
  const initial=[{value:'products"[]',label:'Products',items:[{value:'core',label:'Core',href:'#core',linkProps:{autofocus:true}},{value:'ui',label:'UI',href:'#ui'}]},{value:'docs',label:'Docs',items:[{value:'guide',label:'Guide',href:'#guide'}]},{value:'old',label:'Old',disabled:true,items:[]}];
  try {
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template({sections:initial,hoverDelay:300,closeDelay:100}),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {NavigationMenu} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#one');
window.vetoKey=false;window.vetoPanel=false;window.vetoTrigger=false;window.vetoLink=false;window.submits=0;
let sections=${JSON.stringify(initial)},props={hoverDelay:300,closeDelay:100};
function current(){return {...props,sections:sections.map(section=>({...section,triggerProps:{...section.triggerProps,'@click':event=>{window.triggerTarget=event.currentTarget.tagName;if(window.vetoTrigger)event.preventDefault();}},panelProps:{...section.panelProps,'@keydown':event=>{window.panelTarget=event.currentTarget.tagName;if(window.vetoPanel)event.preventDefault();}},items:(section.items??[]).map(item=>({...item,linkProps:{...item.linkProps,'@click':event=>{window.linkTarget=event.currentTarget.tagName;if(window.vetoLink)event.preventDefault();}}}))})),'@keydown':event=>{window.rootTarget=event.currentTarget.id;if(window.vetoKey)event.preventDefault();}};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};if(patch.sections)sections=patch.sections;draw();};
window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={hoverDelay:300,closeDelay:100};sections=${JSON.stringify(initial)};draw();};
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
    browser = await chromium.launch({ headless: true });
    const url = `http://127.0.0.1:${server.address().port}`;

    const noJS=await browser.newContext({javaScriptEnabled:false});const staticPage=await noJS.newPage();await staticPage.goto(url);
    await browserExpect(staticPage.getByRole('navigation',{name:'Primary'})).toBeVisible();expect(await staticPage.locator('#one [aria-controls]').evaluateAll(elements=>elements.every(el=>!!document.getElementById(el.getAttribute('aria-controls'))))).toBe(true);expect(await staticPage.locator('[role="menu"],[role="menuitem"]').count()).toBe(0);await noJS.close();
    const page=await browser.newPage({hasTouch:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const nav=page.locator('#one'),outside=page.locator('#outside'),products=nav.getByRole('button',{name:'Products',exact:true}),docs=nav.getByRole('button',{name:'Docs',exact:true}),panel=nav.locator('[popover]').first(),core=panel.getByRole('link',{name:'Core',exact:true}),ui=panel.getByRole('link',{name:'UI',exact:true});
    await outside.focus();await products.hover();await browserExpect(products).toHaveAttribute('aria-expanded','false');await browserExpect(products).toHaveAttribute('aria-expanded','true');await browserExpect(outside).toBeFocused();
    await core.hover();await browserExpect(panel).toBeVisible();await core.focus();await outside.hover();await page.waitForTimeout(180);await browserExpect(panel).toBeVisible();await browserExpect(core).toBeFocused();await docs.hover();await page.waitForTimeout(380);await browserExpect(docs).toHaveAttribute('aria-expanded','false');await browserExpect(core).toBeFocused();await outside.hover();await page.keyboard.press('Escape');await browserExpect(products).toBeFocused();await browserExpect(products).toHaveAttribute('aria-expanded','false');
    await outside.focus();await page.keyboard.press('Tab');await browserExpect(products).toBeFocused();await page.keyboard.press('Space');await browserExpect(products).toHaveAttribute('aria-expanded','true');await browserExpect(products).toBeFocused();await page.keyboard.press('Tab');await browserExpect(core).toBeFocused();await page.keyboard.press('Tab');await browserExpect(ui).toBeFocused();await page.keyboard.press('Tab');await browserExpect(docs).toBeFocused();await browserExpect(products).toHaveAttribute('aria-expanded','false');
    await page.evaluate(()=>window.update({trigger:'click'}));await page.evaluate(()=>window.vetoTrigger=true);await products.click();await browserExpect(products).toHaveAttribute('aria-expanded','false');expect(await page.evaluate(()=>window.triggerTarget)).toBe('BUTTON');await page.evaluate(()=>window.vetoTrigger=false);await products.focus();await page.keyboard.press('Enter');await browserExpect(products).toBeFocused();
    await page.evaluate(()=>window.vetoKey=true);await page.keyboard.press('ArrowDown');await browserExpect(products).toBeFocused();expect(await page.evaluate(()=>window.rootTarget)).toBe('one');await page.evaluate(()=>window.vetoKey=false);await page.keyboard.press('ArrowDown');await browserExpect(core).toBeFocused();await page.evaluate(()=>window.vetoPanel=true);await page.keyboard.press('ArrowDown');await browserExpect(core).toBeFocused();expect(await page.evaluate(()=>window.panelTarget)).toBe('DIV');await page.evaluate(()=>window.vetoPanel=false);await page.keyboard.press('ArrowDown');await browserExpect(ui).toBeFocused();await page.keyboard.press('Home');await browserExpect(core).toBeFocused();await page.keyboard.press('End');await browserExpect(ui).toBeFocused();
    await page.evaluate(()=>window.vetoLink=true);await core.click();await browserExpect(panel).toBeVisible();expect(await page.evaluate(()=>location.hash)).toBe('');expect(await page.evaluate(()=>window.linkTarget)).toBe('A');await page.evaluate(()=>window.vetoLink=false);await core.click();await browserExpect(products).toHaveAttribute('aria-expanded','false');expect(await page.evaluate(()=>location.hash)).toBe('#core');
    await products.click();const newTab=page.context().waitForEvent('page');await core.click({modifiers:['Control']});const opened=await newTab;await browserExpect(opened).toHaveURL(/#core$/);await opened.close();await browserExpect(products).toHaveAttribute('aria-expanded','true');
    const other=page.locator('#two').getByRole('button',{name:'Products'}),otherLink=page.locator('#two').getByRole('link',{name:'Other'});await other.click();await browserExpect(products).toHaveAttribute('aria-expanded','false');await page.keyboard.press('Tab');await browserExpect(otherLink).toBeFocused();await page.evaluate(()=>window.update({trigger:'hover'}));await products.hover();await page.waitForTimeout(380);await browserExpect(otherLink).toBeFocused();await browserExpect(other).toHaveAttribute('aria-expanded','true');await browserExpect(products).toHaveAttribute('aria-expanded','false');await outside.click();await browserExpect(outside).toBeFocused();await browserExpect(other).toHaveAttribute('aria-expanded','false');
    await page.evaluate(()=>window.update({hoverDelay:1000}));await products.hover();await page.keyboard.press('Escape');await page.waitForTimeout(1100);await browserExpect(products).toHaveAttribute('aria-expanded','false');await outside.hover();await products.hover();await page.evaluate(()=>window.update({trigger:'click'}));await page.waitForTimeout(1100);await browserExpect(products).toHaveAttribute('aria-expanded','false');
    await page.evaluate(()=>window.update({trigger:'hover',hoverDelay:100}));await outside.hover();await products.tap();await browserExpect(products).toHaveAttribute('aria-expanded','true');await products.tap();await page.waitForTimeout(180);await browserExpect(products).toHaveAttribute('aria-expanded','false');
    await page.evaluate(()=>window.update({trigger:'click',dir:'rtl'}));await products.focus();await page.keyboard.press('ArrowLeft');await browserExpect(docs).toBeFocused();await page.keyboard.press('Home');await browserExpect(products).toBeFocused();await page.keyboard.press('ArrowUp');await browserExpect(ui).toBeFocused();
    await page.evaluate(()=>window.update({sections:[{value:'products"[]',label:'Products',items:[{value:'ui',label:'UI',href:'#ui'},{value:'core',label:'Core',href:'#core'}]},{value:'docs',label:'Docs',items:[]}]}));await browserExpect(ui).toBeFocused();await page.evaluate(()=>window.update({sections:[{value:'products"[]',label:'Products',items:[{value:'core',label:'Core',href:'#core'}]},{value:'docs',label:'Docs',items:[]}]}));await browserExpect(core).toBeFocused();await page.evaluate(()=>window.update({sections:[{value:'products"[]',label:'Products',items:[]},{value:'docs',label:'Docs',items:[]}]}));await browserExpect(panel).toBeFocused();await page.evaluate(()=>window.update({sections:[{value:'docs',label:'Docs',items:[]}]}));await browserExpect(docs).toBeFocused();await page.keyboard.press('ArrowDown');await browserExpect(nav.locator('[popover]')).toBeFocused();
    await page.evaluate(()=>window.update({disabled:true}));await browserExpect(nav).toBeFocused();await browserExpect(docs).toHaveAttribute('aria-expanded','false');await page.evaluate(()=>window.update({disabled:false,sections:[]}));await browserExpect(nav).toBeFocused();
    await page.evaluate(()=>window.fresh());await page.evaluate(()=>window.update({trigger:'click'}));await products.click();await page.keyboard.press('Tab');await browserExpect(core).toBeFocused();await page.locator('#fields').evaluate(el=>el.disabled=true);await browserExpect(products).toHaveAttribute('aria-expanded','false');await browserExpect(nav).toBeFocused();await page.locator('#fields').evaluate(el=>el.disabled=false);
    await page.setViewportSize({width:360,height:280});await page.evaluate(()=>window.update({style:'position:fixed;right:0;bottom:0',sections:[{value:'products"[]',label:'Products',items:Array.from({length:40},(_,i)=>({value:String(i),label:'Link '+i,href:'#item-'+i}))}]}));await products.click();const bounds=await panel.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(361);expect(bounds.y+bounds.height).toBeLessThanOrEqual(281);await browserExpect(panel).toHaveAttribute('data-side','top');await page.keyboard.press('ArrowUp');await browserExpect(panel.getByRole('link',{name:'Link 39',exact:true})).toBeFocused();await page.keyboard.press('Escape');
    await page.evaluate(()=>window.fresh());await page.evaluate(()=>window.update({hoverDelay:1000}));await outside.focus();await products.hover();await page.evaluate(()=>{window.unmount();window.dispatchEvent(new Event('resize'));});await page.waitForTimeout(1100);expect(await page.locator('nav').count()).toBe(0);await page.evaluate(()=>{window.fresh();window.unmount();});await page.evaluate(()=>window.fresh());await products.hover();await browserExpect(products).toHaveAttribute('aria-expanded','true');expect(await page.evaluate(()=>window.submits)).toBe(0);expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
