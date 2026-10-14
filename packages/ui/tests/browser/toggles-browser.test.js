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
import { Toggle, ToggleGroup } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves toggle state, native events, grouped focus and indicator geometry', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-toggles-'));
  let server,browser;
  const templateSource=`(p={},g={},m={},disabled=false)=>html\`<form><fieldset ?disabled=\${disabled}>\${component(Toggle,{id:'toggle',defaultPressed:true,...p},'Bold')}\${component(ToggleGroup,{id:'single',label:'Alignment',items:[{value:'left"[]',label:'Left'},{value:'locked',label:'Locked',disabled:true},{value:'right',label:'Right'}],...g})}\${component(ToggleGroup,{id:'multi',label:'Formatting',type:'multiple',items:[{value:'left',label:'Left'},{value:'locked',label:'Locked',disabled:true},{value:'right',label:'Right'}],...m})}<button id="after" type="button">After</button></fieldset></form>\``;
  const template=new Function('html','component','Toggle','ToggleGroup',`return (${templateSource})`)(html,component,Toggle,ToggleGroup);
  try {
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template({}, {value:'left"[]'}, {value:['left','locked','unknown']}),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Toggle,ToggleGroup as BaseGroup} from '@cossackframework/ui';
class ToggleGroup extends BaseGroup {render(){window.groups??={};window.groups[this.props.id]=this;return super.render();}}
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#toggle'),initialGroup=container.querySelector('#single');
window.parentList=Object.freeze(['left','locked','unknown']);let p={},g={value:'left"[]'},m={value:window.parentList},disabled=false;
window.toggles=[];window.singles=[];window.multiples=[];window.veto=false;window.acceptP=false;window.acceptG=false;window.submits=0;
function draw(){render(template(pp(),gg(),mm(),disabled),container);}
function pp(){return {...p,onPressedChange:value=>{window.toggles.push(value);if(window.acceptP){p={...p,pressed:value};draw();}},'@click':event=>{window.nativeTarget=event.currentTarget.id;if(window.veto)event.preventDefault();}};}
function gg(){return {...g,onValueChange:value=>{window.singles.push(value);if(window.acceptG){g={...g,value};draw();}},'@keydown':event=>{window.groupTarget=event.currentTarget.id;if(window.veto)event.preventDefault();}};}
function mm(){return {...m,onValueChange:values=>{window.multiples.push([...values]);values.push('callback-only');}};}
window.update=(name,next)=>{if(name==='p')p={...p,...next};else if(name==='g')g={...g,...next};else m={...m,...next};draw();};window.disable=value=>{disabled=value;draw();};
hydrate(template(pp(),gg(),mm(),disabled),container);window.retained=initial===container.querySelector('#toggle')&&initialGroup===container.querySelector('#single');
container.addEventListener('submit',event=>{event.preventDefault();window.submits++;});
window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();p={};g={value:'left"[]'};m={defaultValue:['left']};disabled=false;draw();};
window.freshEmpty=()=>{window.unmount();p={};g={items:[],defaultValue:'left"[]'};m={};disabled=false;draw();};
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

    const noJS=await browser.newContext({javaScriptEnabled:false});const staticPage=await noJS.newPage();await staticPage.goto(url);await browserExpect(staticPage.locator('#toggle')).toHaveAttribute('aria-pressed','true');await browserExpect(staticPage.locator('#single').getByRole('button',{name:'Left'})).toHaveAttribute('aria-pressed','true');await browserExpect(staticPage.locator('#multi').getByRole('button',{name:'Locked'})).toHaveAttribute('aria-pressed','true');await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const toggle=page.locator('#toggle'),group=page.locator('#single'),multi=page.locator('#multi'),left=group.getByRole('button',{name:'Left'}),right=group.getByRole('button',{name:'Right'}),indicator=group.locator('.cs-toggle-group__indicator');
    await browserExpect(group).toHaveAccessibleName('Alignment');await page.evaluate(()=>window.update('p',{defaultPressed:false}));await browserExpect(toggle).toHaveAttribute('aria-pressed','true');await toggle.click();await browserExpect(toggle).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>window.nativeTarget)).toBe('toggle');
    await page.evaluate(()=>window.update('p',{pressed:true}));await toggle.click();await browserExpect(toggle).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>window.toggles.at(-1))).toBe(false);await page.evaluate(()=>{window.veto=true;});const before=await page.evaluate(()=>window.toggles.length);await toggle.click();expect(await page.evaluate(()=>window.toggles.length)).toBe(before);
    // A parent rejects an edit by re-rendering with its own value; until then the next press builds on the pending one.
    await page.evaluate(()=>{window.veto=false;window.acceptP=true;window.update('p',{});});await toggle.focus();await page.keyboard.press('Space');await browserExpect(toggle).toHaveAttribute('aria-pressed','false');await page.keyboard.press('Enter');await browserExpect(toggle).toHaveAttribute('aria-pressed','true');
    await page.evaluate(()=>window.update('p',{disabled:true}));await browserExpect(toggle).toBeDisabled();await toggle.click({force:true});await browserExpect(toggle).toHaveAttribute('aria-pressed','true');await page.evaluate(()=>window.update('p',{disabled:false}));
    await right.click();await browserExpect(left).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>window.singles)).toEqual(['right']);await page.evaluate(()=>window.update('g',{value:'right'}));await browserExpect(right).toHaveAttribute('aria-pressed','true');await page.evaluate(()=>window.update('g',{value:'left"[]'}));await browserExpect(left).toHaveAttribute('aria-pressed','true');
    await left.focus();await page.evaluate(()=>{window.veto=true;});await page.keyboard.press('ArrowRight');await browserExpect(left).toBeFocused();expect(await page.evaluate(()=>window.groupTarget)).toBe('single');await page.evaluate(()=>{window.veto=false;window.acceptG=true;});await page.keyboard.press('ArrowRight');await browserExpect(right).toBeFocused();await browserExpect(left).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Enter');await browserExpect(right).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Space');await browserExpect(right).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>window.singles.at(-1))).toBe('');await browserExpect(indicator).not.toBeVisible();
    await right.click();await browserExpect.poll(async()=>Math.abs((await indicator.boundingBox()).width-(await right.boundingBox()).width)).toBeLessThan(1);await right.evaluate(el=>el.style.paddingLeft='70px');await browserExpect.poll(async()=>Math.abs((await indicator.boundingBox()).width-(await right.boundingBox()).width)).toBeLessThan(1);
    await page.evaluate(()=>window.update('g',{dir:'rtl'}));await right.focus();await page.keyboard.press('ArrowRight');await browserExpect(left).toBeFocused();await page.evaluate(()=>window.update('g',{orientation:'vertical'}));await page.keyboard.press('ArrowDown');await browserExpect(right).toBeFocused();await page.keyboard.press('Home');await browserExpect(left).toBeFocused();await page.keyboard.press('End');await browserExpect(right).toBeFocused();await browserExpect.poll(async()=>Math.abs((await indicator.boundingBox()).height-(await right.boundingBox()).height)).toBeLessThan(1);
    await multi.getByRole('button',{name:'Right'}).click();expect(await page.evaluate(()=>window.multiples.at(-1))).toEqual(['left','locked','unknown','right']);expect(await page.evaluate(()=>window.parentList)).toEqual(['left','locked','unknown']);await browserExpect(multi.getByRole('button',{name:'Right'})).toHaveAttribute('aria-pressed','false');
    await page.evaluate(()=>window.disable(true));await browserExpect(toggle).toBeDisabled();await browserExpect(right).toBeDisabled();await right.click({force:true});await browserExpect(right).toHaveAttribute('aria-pressed','true');await page.evaluate(()=>window.disable(false));
    await right.focus();await page.evaluate(()=>window.update('g',{items:[{value:'right',label:'Right'},{value:'left"[]',label:'Left'}]}));await browserExpect(right).toBeFocused();await page.evaluate(()=>window.update('g',{items:[{value:'left"[]',label:'Left'}]}));await browserExpect(left).toBeFocused();await browserExpect(indicator).not.toBeVisible();await page.evaluate(()=>window.update('g',{disabled:true}));await browserExpect(group).toBeFocused();
    await page.evaluate(()=>window.fresh());await multi.getByRole('button',{name:'Right'}).click();await browserExpect(multi.getByRole('button',{name:'Right'})).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>window.groups.multi.isSelected('callback-only'))).toBe(false);await multi.getByRole('button',{name:'Locked'}).click({force:true});await browserExpect(multi.getByRole('button',{name:'Locked'})).toHaveAttribute('aria-pressed','false');
    await page.emulateMedia({reducedMotion:'reduce'});await browserExpect(indicator).toHaveCSS('transition-property','none');expect(await page.evaluate(()=>window.submits)).toBe(0);await page.evaluate(()=>{window.update('g',{value:'right'});window.unmount();window.dispatchEvent(new Event('resize'));});await page.evaluate(()=>window.fresh());await right.click();await browserExpect(right).toHaveAttribute('aria-pressed','true');await page.evaluate(()=>window.freshEmpty());await page.evaluate(()=>window.update('g',{defaultValue:'right',items:[{value:'left"[]',label:'Left'},{value:'right',label:'Right'}]}));await browserExpect(left).toHaveAttribute('aria-pressed','true');await browserExpect(right).toHaveAttribute('aria-pressed','false');expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
