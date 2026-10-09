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
import { Pagination } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('keeps controlled pagination, native links and keyed focus through hydration and updates', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-pagination-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<input id="outside"><form><fieldset id="fields">\${component(Pagination,{id:'pages',label:'Results',page:3,totalPages:20,maxButtons:3,onPageChange:()=>{},...p})}<button id="after" type="button">After</button></fieldset></form><div id="page-2">Second page</div>\``;
  const template=new Function('html','component','Pagination',`return (${templateSource})`)(html,component,Pagination);
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
import {Pagination} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#pages');
let props={},links=false;window.changes=[];window.accept=false;window.veto=false;window.submits=0;
function current(){return {...props,'@keydown':event=>window.rootTarget=event.currentTarget.tagName,...(links?{onPageChange:undefined,href:page=>'#page-'+page,linkProps:{'@click':event=>{window.nativeTarget=event.currentTarget.tagName;if(window.veto)event.preventDefault();}}}:{onPageChange:page=>{window.changes.push(page);if(window.accept){props.page=page;draw();}},buttonProps:{'data-control':'true','@click':event=>{window.nativeTarget=event.currentTarget.tagName;if(window.veto)event.preventDefault();}}})};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.links=()=>{links=true;props={page:1,totalPages:3};draw();};
window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();links=false;props={};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#pages');
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

    const noJS=await browser.newContext({javaScriptEnabled:false}),staticPage=await noJS.newPage();
    await staticPage.goto(url);
    await staticPage.setContent(renderToString(template({page:1,totalPages:3,onPageChange:undefined,href:page=>'#page-'+page})));
    await browserExpect(staticPage.getByRole('navigation',{name:'Results'})).toBeVisible();
    await staticPage.getByRole('link',{name:'Page 2',exact:true}).click();
    await browserExpect(staticPage).toHaveURL(/#page-2$/);await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const nav=page.getByRole('navigation',{name:'Results'}),outside=page.locator('#outside'),previous=nav.getByRole('button',{name:'Previous page'}),next=nav.getByRole('button',{name:'Next page'}),number=value=>nav.getByRole('button',{name:'Page '+value,exact:true});
    await browserExpect(nav).toHaveAttribute('id','pages');await browserExpect(number(3)).toHaveAttribute('aria-current','page');await outside.focus();await page.keyboard.press('Tab');await browserExpect(previous).toBeFocused();await page.keyboard.press('Tab');await browserExpect(number(1)).toBeFocused();await page.keyboard.press('ArrowRight');await browserExpect(number(1)).toBeFocused();expect(await page.evaluate(()=>window.rootTarget)).toBe('NAV');
    await number(4).focus();await page.keyboard.press('Space');expect(await page.evaluate(()=>window.changes)).toEqual([4]);await browserExpect(number(3)).toHaveAttribute('aria-current','page');await browserExpect(number(4)).toBeFocused();expect(await page.evaluate(()=>window.nativeTarget)).toBe('BUTTON');
    await page.evaluate(()=>window.veto=true);await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.changes)).toEqual([4]);await page.evaluate(()=>{window.veto=false;window.accept=true;});await page.keyboard.press('Enter');await browserExpect(number(4)).toHaveAttribute('aria-current','page');await browserExpect(number(4)).toBeFocused();await number(4).click();expect(await page.evaluate(()=>window.changes)).toEqual([4,4]);
    await next.click();await browserExpect(number(5)).toHaveAttribute('aria-current','page');await browserExpect(next).toBeFocused();await page.evaluate(()=>window.update({page:5,maxButtons:1}));await browserExpect(next).toBeFocused();await number(5).focus();await page.evaluate(()=>window.update({totalPages:2}));await browserExpect(number(2)).toBeFocused();await browserExpect(number(2)).toHaveAttribute('aria-current','page');await browserExpect(next).toBeDisabled();expect(await page.evaluate(()=>window.changes)).toEqual([4,4,5]);
    await outside.focus();await page.evaluate(()=>window.update({page:1,totalPages:20}));await browserExpect(outside).toBeFocused();await number(1).focus();await page.evaluate(()=>window.update({disabled:true}));await browserExpect(nav).toBeFocused();await browserExpect(previous).toBeDisabled();await browserExpect(next).toBeDisabled();await page.evaluate(()=>window.update({disabled:false,totalPages:0}));expect(await nav.getByRole('button').count()).toBe(2);expect(await nav.locator('[aria-current="page"]').count()).toBe(0);await browserExpect(next).toBeDisabled();
    await page.evaluate(()=>window.update({page:2,totalPages:3}));await page.locator('#fields').evaluate(el=>el.disabled=true);await browserExpect(number(2)).toBeDisabled();await number(2).evaluate(el=>el.click());expect(await page.evaluate(()=>window.changes)).toEqual([4,4,5]);await page.locator('#fields').evaluate(el=>el.disabled=false);
    await page.evaluate(()=>window.links());const first=nav.getByRole('link',{name:'Page 1',exact:true}),second=nav.getByRole('link',{name:'Page 2',exact:true}),back=nav.getByRole('link',{name:'Previous page'});await browserExpect(first).toHaveAttribute('aria-current','page');await browserExpect(back).toHaveAttribute('aria-disabled','true');expect(await back.getAttribute('href')).toBeNull();await outside.focus();await page.keyboard.press('Tab');await browserExpect(first).toBeFocused();
    await page.evaluate(()=>window.veto=true);await second.click();expect(await page.evaluate(()=>location.hash)).toBe('');expect(await page.evaluate(()=>window.nativeTarget)).toBe('A');await page.evaluate(()=>window.veto=false);await second.click();expect(await page.evaluate(()=>location.hash)).toBe('#page-2');await browserExpect(first).toHaveAttribute('aria-current','page');
    const openedPromise=page.context().waitForEvent('page');await second.click({modifiers:['Control']});const opened=await openedPromise;await browserExpect(opened).toHaveURL(/#page-2$/);await opened.close();await second.focus();await page.evaluate(()=>window.update({disabled:true}));await browserExpect(nav).toBeFocused();expect(await nav.locator('a[href]').count()).toBe(0);await second.evaluate(el=>el.click());expect(await page.evaluate(()=>window.changes)).toEqual([4,4,5]);
    await page.evaluate(()=>{window.fresh();window.unmount();});expect(await page.locator('nav').count()).toBe(0);await page.evaluate(()=>window.fresh());await number(3).click();await browserExpect(number(3)).toHaveAttribute('aria-current','page');expect(await page.evaluate(()=>window.submits)).toBe(0);expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
