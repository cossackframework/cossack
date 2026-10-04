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
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, ScrollArea } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('preserves native table composition and named scroll viewports through hydration', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-table-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<input id="outside">\${component(Table,{id:'people','aria-label':'People',striped:p.striped??true,wrapperProps:{id:'overflow',style:'width:240px;',tabindex:0,role:'region','aria-label':'People scroll','@scroll':p.scroll},style:'min-width:600px;','@click':p.capture},html\`<caption>People directory</caption>\${component(TableHeader,{id:'head','@click':p.capture},component(TableRow,{id:'heading','@click':p.capture},html\`\${component(TableHead,{id:'name',scope:'col',abbr:'Name','@click':p.capture},'Name')}\${component(TableHead,{id:'actions',scope:'col',colspan:2,'@click':p.capture},'Actions')}\`))}\${component(TableBody,{id:'body','@click':p.capture},[1,2,3].map(i=>component(TableRow,{id:'row-'+i,'@click':p.capture},html\`\${component(TableCell,{id:'cell-'+i,headers:'name',rowspan:1,'@click':p.capture},i===1?p.name??'Alice':'Person '+i)}\${component(TableCell,{headers:'actions',colspan:2},html\`<button type="button" id=\${'edit-'+i} @click=\${p.action}>Edit \${i}</button>\`)}\`)))}\`)}\${component(ScrollArea,{label:p.label??'Messages',id:'messages',height:p.height??120,style:'width:240px;','@scroll':p.scroll},html\`<div style="height:800px;width:600px;">Messages content <a href="#destination" id="message-link">Details</a></div>\`)}<button id="after">After</button><div id="destination">Details</div>\``;
  const template=new Function('html','component','Table','TableHeader','TableBody','TableRow','TableHead','TableCell','ScrollArea',`return (${templateSource})`)(html,component,Table,TableHeader,TableBody,TableRow,TableHead,TableCell,ScrollArea);
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
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell,ScrollArea} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=[...container.querySelectorAll('#people,#head,#body,#heading,#name,#cell-1,#messages')];let props={};window.actions=0;window.targets=[];window.scrolls=[];
function current(){return {...props,capture:event=>window.targets.push(event.currentTarget.tagName+'#'+event.currentTarget.id),action:()=>window.actions++,scroll:event=>window.scrolls.push(event.currentTarget.id)};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
hydrate(template(current()),container);window.retained=initial.every(node=>node===container.querySelector('#'+node.id));
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

    const noJS=await browser.newContext({javaScriptEnabled:false}),staticPage=await noJS.newPage();
    await staticPage.goto(url);
    await browserExpect(staticPage.getByRole('table',{name:'People'})).toBeVisible();
    await browserExpect(staticPage.getByRole('columnheader',{name:'Name',exact:true})).toBeVisible();
    await browserExpect(staticPage.getByRole('region',{name:'Messages'})).toBeVisible();
    await browserExpect(staticPage.getByRole('region',{name:'People scroll'})).toBeVisible();
    await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const table=page.locator('#people'),viewport=page.locator('#messages');
    await browserExpect(page.locator('#overflow')).toHaveRole('region');
    await browserExpect(page.locator('#overflow')).toHaveAccessibleName('People scroll');
    expect(await table.locator(':scope > thead > tr > th').count()).toBe(2);
    expect(await table.locator(':scope > tbody > tr').count()).toBe(3);
    expect(await table.locator(':scope > tbody > tr > td').count()).toBe(6);
    expect(await table.locator(':scope > caption').count()).toBe(1);
    await browserExpect(page.locator('#cell-1')).toHaveText('Alice');
    await browserExpect(page.locator('#cell-1')).toHaveAttribute('headers','name');
    expect(await page.locator('#actions').evaluate(el=>({span:el.colSpan,scope:el.scope}))).toEqual({span:2,scope:'col'});
    await page.locator('#name').evaluate(el=>el.click());await page.locator('#cell-1').evaluate(el=>el.click());
    expect(await page.evaluate(()=>window.targets)).toEqual(expect.arrayContaining(['TH#name','TR#heading','THEAD#head','TABLE#people','TD#cell-1','TR#row-1','TBODY#body']));
    const color=()=>page.locator('#row-2').evaluate(el=>getComputedStyle(el).backgroundColor);
    const striped=await color();expect(striped).not.toBe('rgba(0, 0, 0, 0)');
    await page.evaluate(()=>window.update({striped:false,name:'Alicia',label:'Recent messages',height:100}));
    await browserExpect(page.locator('#cell-1')).toHaveText('Alicia');expect(await color()).not.toBe(striped);
    await browserExpect(viewport).toHaveAccessibleName('Recent messages');expect(await viewport.evaluate(el=>el.clientHeight)).toBe(100);
    await page.locator('#outside').focus();await page.keyboard.press('Tab');await browserExpect(page.locator('#overflow')).toBeFocused();
    await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('#overflow').scrollLeft>0);
    expect(await page.evaluate(()=>window.scrolls)).toContain('overflow');
    await page.keyboard.press('Tab');await browserExpect(page.locator('#edit-1')).toBeFocused();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.actions)).toBe(1);
    await page.locator('#edit-3').focus();await page.keyboard.press('Tab');await browserExpect(viewport).toBeFocused();
    await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.querySelector('#messages').scrollTop>0);
    expect(await page.evaluate(()=>window.scrolls)).toContain('messages');
    await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('#messages').scrollLeft>0);
    await page.locator('#message-link').focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>location.hash)).toBe('#destination');
    await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('#row-1').evaluate(el=>getComputedStyle(el).transitionProperty)).toBe('none');
    await page.evaluate(()=>window.unmount());expect(await page.locator('.cs-table,.cs-scroll-area').count()).toBe(0);
    await page.evaluate(()=>window.fresh());await browserExpect(page.locator('#cell-1')).toHaveText('Alice');
    await page.locator('#edit-1').click();expect(await page.evaluate(()=>window.actions)).toBe(2);
    expect(await page.locator('#people > tbody > tr > td').count()).toBe(6);expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
