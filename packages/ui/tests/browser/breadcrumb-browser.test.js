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
import { Breadcrumb } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves native breadcrumb links, names and keyed focus through hydration and updates', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-breadcrumb-'));
  let server,browser;
  const initial=[{value:'home"[]',label:'Home',href:'#home'},{value:'docs',label:'Docs',href:'#docs'},{value:'current',label:'Current',href:'#current'}];
  const templateSource=`(p={})=>html\`<input id="outside">\${component(Breadcrumb,{id:'trail',label:'Location',items:${JSON.stringify(initial)},...p})}<button id="after">After</button><div id="home">Home destination</div><div id="docs">Docs destination</div><div id="current">Current destination</div>\``;
  const template=new Function('html','component','Breadcrumb',`return (${templateSource})`)(html,component,Breadcrumb);
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
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Breadcrumb} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#trail'),initialItems=${JSON.stringify(initial)};
let props={};window.veto=false;
function current(){return {...props,items:(props.items??initialItems).map(item=>({...item,...(item.href!==undefined?{linkProps:{...item.linkProps,'@click':event=>{window.nativeTarget=event.currentTarget.tagName;if(window.veto)event.preventDefault();}}}:{textProps:{...item.textProps,'@click':event=>window.nativeTarget=event.currentTarget.tagName}})})),listProps:{'data-list':'trail','@click':event=>window.listTarget=event.currentTarget.tagName},'@keydown':event=>window.rootTarget=event.currentTarget.tagName};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};
window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#trail');
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

    const noJS=await browser.newContext({javaScriptEnabled:false}),staticPage=await noJS.newPage();await staticPage.goto(url);await browserExpect(staticPage.getByRole('navigation',{name:'Location'})).toBeVisible();await staticPage.getByRole('link',{name:'Current',exact:true}).click();await browserExpect(staticPage).toHaveURL(/#current$/);await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const nav=page.getByRole('navigation',{name:'Location'}),outside=page.locator('#outside'),home=nav.getByRole('link',{name:'Home',exact:true}),docs=nav.getByRole('link',{name:'Docs',exact:true}),current=nav.getByRole('link',{name:'Current',exact:true});
    await browserExpect(nav.locator('ol')).toHaveAttribute('data-list','trail');await browserExpect(current).toHaveAttribute('aria-current','page');expect(await nav.locator('[aria-current="page"]').count()).toBe(1);expect(await nav.locator('.cs-breadcrumb__separator').evaluateAll(nodes=>nodes.every(node=>node.getAttribute('aria-hidden')==='true'))).toBe(true);
    await outside.focus();await page.keyboard.press('Tab');await browserExpect(home).toBeFocused();await page.keyboard.press('ArrowRight');await browserExpect(home).toBeFocused();expect(await page.evaluate(()=>window.rootTarget)).toBe('NAV');await page.keyboard.press('Tab');await browserExpect(docs).toBeFocused();await page.keyboard.press('Tab');await browserExpect(current).toBeFocused();await page.keyboard.press('Tab');await browserExpect(page.locator('#after')).toBeFocused();await page.keyboard.press('Shift+Tab');await browserExpect(current).toBeFocused();
    await page.evaluate(()=>window.veto=true);await docs.click();expect(await page.evaluate(()=>location.hash)).toBe('');expect(await page.evaluate(()=>window.nativeTarget)).toBe('A');expect(await page.evaluate(()=>window.listTarget)).toBe('OL');await page.evaluate(()=>window.veto=false);await docs.focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>location.hash)).toBe('#docs');
    const openedPromise=page.context().waitForEvent('page');await current.click({modifiers:['Control']});const opened=await openedPromise;await browserExpect(opened).toHaveURL(/#current$/);await opened.close();
    await docs.focus();await page.evaluate(()=>window.update({dir:'rtl',items:[{value:'docs',label:'Docs',href:'#docs'},{value:'home"[]',label:'Home',href:'#home'},{value:'current',label:'Current',href:'#current'}]}));await browserExpect(docs).toBeFocused();expect(await nav.locator('a').allTextContents()).toEqual(['Docs','Home','Current']);await page.keyboard.press('Tab');await browserExpect(home).toBeFocused();
    await page.evaluate(()=>window.update({items:[{value:'docs',label:'Docs',href:'#docs'},{value:'current',label:'Current'}]}));await browserExpect(docs).toBeFocused();expect(await nav.getByRole('link').count()).toBe(1);await browserExpect(nav.locator('span[aria-current="page"]')).toHaveText('Current');await nav.locator('span[aria-current="page"]').click();expect(await page.evaluate(()=>window.nativeTarget)).toBe('SPAN');
    await docs.focus();await page.evaluate(()=>window.update({items:[{value:'docs',label:'Docs'},{value:'current',label:'Current'}]}));await browserExpect(nav).toBeFocused();await outside.focus();await page.evaluate(()=>window.update({items:[]}));await browserExpect(outside).toBeFocused();expect(await nav.locator('li').count()).toBe(0);
    await page.evaluate(()=>window.update({items:[{value:'current',label:'◆',ariaLabel:'Current location'}]}));const accessible=await nav.ariaSnapshot();expect(accessible).toContain('Current location');expect(accessible).not.toContain('◆');
    await page.evaluate(()=>{window.fresh();window.unmount();});expect(await page.locator('nav').count()).toBe(0);await page.evaluate(()=>window.fresh());await home.focus();await browserExpect(home).toBeFocused();expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
