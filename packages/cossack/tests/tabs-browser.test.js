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
import { Tabs } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('preserves tab selection, focus, identity and responsive indicators', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-tabs-'));
  let server,browser;
  const templateSource=`(props={},other={})=>{const {reverse,...actual}=props;const items=[{value:'first weird/#',label:'First',content:html\`<input aria-label="First field">\`},{value:'disabled',label:'Unavailable',disabled:true,content:'Disabled content'},{value:'last',label:'Last',content:html\`<input aria-label="Last field">\`}];return html\`<button id="before">Before</button>\${component(Tabs,{id:'one',label:'Primary tabs',items:reverse?[...items].reverse():items,...actual})}\${component(Tabs,{id:'two',label:'Secondary tabs',defaultValue:'last',activation:'manual',items:[{value:'first weird/#',label:'First',content:'First secondary'},{value:'last',label:'Last',content:'Last secondary'}],...other})}<button id="after">After</button>\`}`;
  const template=new Function('html','component','Tabs',`return (${templateSource})`)(html,component,Tabs);
  try {
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template({value:'first weird/#'}),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Tabs} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#one [role=tab]'),initialPanel=container.querySelector('#one [role=tabpanel]');
let props={value:'first weird/#'},other={};window.events=[];window.accept=false;window.veto=false;
const callbacks={onChange:value=>{window.events.push(value);if(window.accept){props={...props,value};draw();}},listProps:{'@keydown':event=>{window.listTarget=event.currentTarget.id;if(window.veto)event.preventDefault();}}};
function draw(){render(template({...props,...callbacks},other),container);}
window.update=next=>{props={...props,...next};draw();};window.updateOther=next=>{other={...other,...next};draw();};
hydrate(template({...props,...callbacks},other),container);window.retained=initial===container.querySelector('#one [role=tab]')&&initialPanel===container.querySelector('#one [role=tabpanel]');
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=()=>{window.unmount();props={value:'first weird/#'};other={};window.events=[];draw();};
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

    const noJS=await browser.newContext({javaScriptEnabled:false});const staticPage=await noJS.newPage();await staticPage.goto(url);await browserExpect(staticPage.locator('#one').getByRole('tabpanel')).toHaveCount(1);await browserExpect(staticPage.locator('#two').getByRole('tab',{name:'Last',exact:true})).toHaveAttribute('aria-selected','true');await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const one=page.locator('#one'),two=page.locator('#two'),first=one.getByRole('tab',{name:'First',exact:true}),last=one.getByRole('tab',{name:'Last',exact:true}),indicator=one.locator('.cs-tabs__indicator');
    const ids=await page.locator('[id]').evaluateAll(elements=>elements.map(el=>el.id));expect(new Set(ids).size).toBe(ids.length);await browserExpect(one.getByRole('tablist')).toHaveAccessibleName('Primary tabs');await browserExpect(first).toHaveAttribute('aria-controls','one-panel-first%20weird%2F%23');
    await last.click();expect(await page.evaluate(()=>window.events)).toEqual(['last']);await browserExpect(first).toHaveAttribute('aria-selected','true');await browserExpect(last).toBeFocused();
    await page.evaluate(()=>window.update({value:'last'}));await browserExpect(last).toHaveAttribute('aria-selected','true');await page.evaluate(()=>window.update({value:'first weird/#'}));await browserExpect(first).toHaveAttribute('aria-selected','true');
    await first.focus();await page.evaluate(()=>{window.veto=true;});await page.keyboard.press('ArrowRight');await browserExpect(first).toBeFocused();expect(await page.evaluate(()=>window.listTarget)).toBe('one-list');await page.evaluate(()=>{window.veto=false;window.accept=true;});
    await page.keyboard.press('ArrowRight');await browserExpect(last).toBeFocused();await browserExpect(last).toHaveAttribute('aria-selected','true');await page.keyboard.press('Tab');await browserExpect(one.getByRole('tabpanel')).toBeFocused();await page.keyboard.press('Tab');await browserExpect(page.getByLabel('Last field')).toBeFocused();
    await page.evaluate(()=>window.update({value:'first weird/#'}));await browserExpect(first).toBeFocused();await page.getByLabel('First field').fill('Keep this edit');await last.click();await first.click();await browserExpect(page.getByLabel('First field')).toHaveValue('Keep this edit');await page.getByLabel('First field').focus();await page.evaluate(()=>window.update({reverse:true}));await browserExpect(page.getByLabel('First field')).toBeFocused();await browserExpect(page.getByLabel('First field')).toHaveValue('Keep this edit');await page.evaluate(()=>window.update({reverse:false}));await browserExpect(page.getByLabel('First field')).toBeFocused();
    await page.evaluate(()=>window.update({dir:'rtl'}));await first.focus();await page.keyboard.press('ArrowLeft');await browserExpect(last).toBeFocused();await page.keyboard.press('ArrowRight');await browserExpect(first).toBeFocused();
    await page.evaluate(()=>window.update({orientation:'vertical'}));await page.keyboard.press('ArrowDown');await browserExpect(last).toBeFocused();await page.keyboard.press('ArrowLeft');await browserExpect(last).toBeFocused();await page.keyboard.press('Home');await browserExpect(first).toBeFocused();await page.keyboard.press('End');await browserExpect(last).toBeFocused();
    await page.evaluate(()=>window.update({orientation:'horizontal',dir:'ltr',variant:'underline'}));await browserExpect.poll(()=>indicator.evaluate(el=>parseFloat(el.style.width))).toBe(await last.evaluate(el=>el.offsetWidth));await browserExpect.poll(async()=>Math.abs((await indicator.boundingBox()).width-(await last.boundingBox()).width)).toBeLessThan(1);await browserExpect(indicator).toHaveCSS('height','2px');await last.evaluate(el=>el.style.paddingLeft='70px');await browserExpect.poll(()=>indicator.evaluate(el=>parseFloat(el.style.width))).toBe(await last.evaluate(el=>el.offsetWidth));await browserExpect.poll(async()=>Math.abs((await indicator.boundingBox()).width-(await last.boundingBox()).width)).toBeLessThan(1);
    await page.emulateMedia({reducedMotion:'reduce'});await browserExpect(indicator).toHaveCSS('transition-property','none');await page.evaluate(()=>window.update({orientation:'vertical',dir:'rtl'}));await browserExpect(indicator).toHaveCSS('width','2px');await browserExpect.poll(async()=>Math.abs((await indicator.boundingBox()).y-(await last.boundingBox()).y)).toBeLessThan(1);await browserExpect.poll(async()=>Math.abs((await indicator.boundingBox()).height-(await last.boundingBox()).height)).toBeLessThan(1);await page.evaluate(()=>window.update({orientation:'horizontal',dir:'ltr'}));
    const secondFirst=two.getByRole('tab',{name:'First',exact:true}),secondLast=two.getByRole('tab',{name:'Last',exact:true});await page.evaluate(()=>window.updateOther({defaultValue:'first weird/#'}));await browserExpect(secondLast).toHaveAttribute('aria-selected','true');await secondLast.focus();await page.keyboard.press('Home');await browserExpect(secondFirst).toBeFocused();await browserExpect(secondLast).toHaveAttribute('aria-selected','true');await page.keyboard.press('Enter');await browserExpect(secondFirst).toHaveAttribute('aria-selected','true');
    await last.focus();await page.evaluate(()=>window.update({items:[{value:'last',label:'Last'},{value:'first weird/#',label:'First'}]}));await browserExpect(last).toBeFocused();await page.evaluate(()=>window.update({items:[{value:'first weird/#',label:'First'}]}));await browserExpect(first).toBeFocused();await browserExpect(first).toHaveAttribute('aria-selected','true');
    await page.evaluate(()=>window.update({items:[{value:'first weird/#',label:'First',disabled:true}]}));await browserExpect(one.getByRole('tablist')).toBeFocused();await browserExpect(indicator).not.toBeVisible();await browserExpect(one.getByRole('tabpanel')).toHaveCount(0);await page.evaluate(()=>window.update({items:[]}));await browserExpect(one.getByRole('tab')).toHaveCount(0);
    await page.evaluate(()=>{window.fresh();window.update({value:'last'});window.unmount();window.dispatchEvent(new Event('resize'));});await page.evaluate(()=>window.fresh());await last.click();await browserExpect(last).toHaveAttribute('aria-selected','true');expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
