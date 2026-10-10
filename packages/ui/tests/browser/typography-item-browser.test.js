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
import { Typography, Item } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves typography native variants and Item child actions through hydration', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-typography-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<input id="outside">\${['h1','h2','h3','h4','p','lead','muted','small','code','kbd','ul','ol','blockquote'].map(variant=>component(Typography,{variant,id:'text-'+variant,'@click':p.capture,...(variant==='ol'?{start:5,reversed:true,type:p.listType??'A'}:variant==='blockquote'?{cite:'https://example.test/source'}:{})},variant==='ul'||variant==='ol'?html\`<li>First</li><li>Second</li>\`:variant))}\${component(Typography,{id:'changing',variant:p.variant??'p','@click':p.capture},p.variant==='ol'?html\`<li>Changed</li>\`:'Changed')}<form @submit=\${p.submit}>\${component(Item,{id:'row',hoverable:true,compact:p.compact??false,divider:p.divider??true,'data-row':'one','@click':p.capture,media:html\`<span aria-hidden="true">?</span>\`,trailing:html\`<button id="edit" type="button" @click=\${p.action}>Edit</button>\`},html\`<a id="link" href="#destination">Record</a>\`)}</form><button id="after">After</button><div id="destination">Record content</div>\``;
  const template=new Function('html','component','Typography','Item',`return (${templateSource})`)(html,component,Typography,Item);
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
import {Typography,Item} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#row');let props={};window.actions=0;window.submissions=0;window.targets=[];
function current(){return {...props,capture:event=>window.targets.push(event.currentTarget.tagName+'#'+event.currentTarget.id),action:()=>window.actions++,submit:event=>{event.preventDefault();window.submissions++;}};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#row');
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
    for (const level of [1,2,3,4]) await browserExpect(staticPage.getByRole('heading',{level,name:'h'+level,exact:true})).toBeVisible();
    await staticPage.getByRole('link',{name:'Record',exact:true}).click(); await browserExpect(staticPage).toHaveURL(/#destination$/); await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    for (const variant of ['h1','h2','h3','h4','p','lead','muted','small','code','kbd','ul','ol','blockquote']) {
      const tag=['lead','muted'].includes(variant)?'P':variant.toUpperCase(),element=page.locator('#text-'+variant);
      expect(await element.evaluate(el=>el.tagName)).toBe(tag);await element.evaluate(el=>el.click());
      expect(await page.evaluate(()=>window.targets)).toContain(tag+'#text-'+variant);
    }
    const ol=page.locator('#text-ol'); expect(await ol.evaluate(el=>({start:el.start,reversed:el.reversed,type:el.type}))).toEqual({start:5,reversed:true,type:'A'});
    expect(await ol.evaluate(el=>getComputedStyle(el).listStyleType)).toBe('upper-alpha');
    for (const [type,style] of [['a','lower-alpha'],['i','lower-roman'],['I','upper-roman'],['1','decimal']]) {
      await page.evaluate(type=>window.update({listType:type}),type);
      await browserExpect(ol).toHaveAttribute('type',type);
      expect(await ol.evaluate(el=>getComputedStyle(el).listStyleType)).toBe(style);
    }
    await browserExpect(page.locator('#text-blockquote')).toHaveAttribute('cite','https://example.test/source');
    const row=page.locator('#row'),edit=page.locator('#edit'),link=page.locator('#link');
    await browserExpect(row).toHaveAttribute('data-row','one'); expect(await row.evaluate(el=>getComputedStyle(el).paddingTop)).toBe('10px');
    await page.locator('#outside').focus();await page.keyboard.press('Tab');await browserExpect(link).toBeFocused();await page.keyboard.press('Enter');expect(await page.evaluate(()=>location.hash)).toBe('#destination');
    await link.focus();await page.keyboard.press('Tab');await browserExpect(edit).toBeFocused();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.actions)).toBe(1);expect(await page.evaluate(()=>window.submissions)).toBe(0);
    await row.hover(); expect(await row.evaluate(el=>getComputedStyle(el).cursor)).toBe('auto');
    await page.evaluate(()=>window.update({compact:true,divider:false,variant:'h2'}));await browserExpect(page.locator('#changing')).toHaveRole('heading');expect(await row.evaluate(el=>getComputedStyle(el).paddingTop)).toBe('6px');expect(await row.evaluate(el=>getComputedStyle(el).borderBottomWidth)).toBe('0px');
    await page.evaluate(()=>window.update({variant:'ol'}));expect(await page.locator('#changing').evaluate(el=>el.tagName)).toBe('OL');await browserExpect(page.locator('#changing li')).toHaveText('Changed');
    await page.emulateMedia({reducedMotion:'reduce'});expect(await row.evaluate(el=>getComputedStyle(el).transitionProperty)).toBe('none');
    await page.evaluate(()=>window.unmount());expect(await page.locator('.cs-item,.cs-typography').count()).toBe(0);await page.evaluate(()=>window.fresh());await edit.click();expect(await page.evaluate(()=>window.actions)).toBe(2);expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
