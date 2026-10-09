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
import { Combobox } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('hydrates a labeled combobox and supports selection, cancellation, keyboard and form contracts', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-combobox-'));
  let server,browser;
  const options=[{value:'us',label:'United States'},{value:'de',label:'Germany',disabled:true},{value:'vn',label:'Vietnam'},{value:'jp',label:'Japan'}];
  const templateSource=`(props={})=>html\`<form id="countries"><label for="country">Country</label><fieldset>\${component(Combobox,{id:'country',name:'country',options:${JSON.stringify(options)},defaultValue:'us',required:true,...props})}</fieldset><button type="button" id="after">After</button></form>\``;
  const template=new Function('html','component','Combobox',`return (${templateSource})`)(html,component,Combobox);
  try {
    const scope=path.join(root,'node_modules/@cossackframework');
    await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><body><main id="app">${minifyHtml(renderToString(template(),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Combobox} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#country');
let props={};window.changes=[];window.native=[];
const callbacks={onChange:value=>{window.changes.push(value);if(window.accept){props.value=value;draw();}},'@input':event=>window.native.push(event.currentTarget.id),'@keydown':event=>{if(window.veto)event.preventDefault();}};
function draw(){render(template({...props,...callbacks}),container);}
window.update=next=>{props={...props,...next};draw();};
hydrate(template(callbacks),container);window.retained=initial===container.querySelector('#country');
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=()=>{window.unmount();props={};draw();};
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


    const noJS=await browser.newContext({javaScriptEnabled:false});
    const initial=await noJS.newPage();await initial.goto(url);
    await browserExpect(initial.getByRole('combobox',{name:'Country'})).toHaveValue('United States');
    await browserExpect(initial.locator('input[type=hidden]')).toHaveValue('us');
    await noJS.close();
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
    await page.waitForFunction(()=>window.retained!==undefined);
    expect(await page.evaluate(()=>window.retained)).toBe(true);
    const input=page.getByRole('combobox',{name:'Country'}),list=page.getByRole('listbox');
    const formValue=()=>page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('form'))));
    await browserExpect(input).toHaveAttribute('aria-expanded','false');
    await input.focus();await input.press('ArrowDown');
    await browserExpect(list).toBeVisible();await browserExpect(input).toBeFocused();
    await browserExpect(input).toHaveAttribute('aria-activedescendant','country-listbox-0');
    expect(await input.evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');
    const geometry=await page.evaluate(()=>{const input=document.querySelector('#country').getBoundingClientRect(),popup=document.querySelector('#country-listbox').getBoundingClientRect();return {input:input.width,popup:popup.width,left:popup.left,right:popup.right,viewport:innerWidth};});
    expect(Math.abs(geometry.input-geometry.popup)).toBeLessThan(1);
    expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    await list.getByRole('option',{name:'Germany'}).click({force:true});
    expect(await page.evaluate(()=>window.changes)).toEqual([]);
    await input.press('ArrowDown');
    await browserExpect(input).toHaveAttribute('aria-activedescendant','country-listbox-2');
    await input.press('Enter');await browserExpect(input).toHaveValue('Vietnam');
    await browserExpect(input).toHaveAttribute('aria-expanded','false');
    expect(await formValue()).toEqual({country:'vn'});
    expect(await page.evaluate(()=>window.changes)).toEqual(['vn']);
    await input.fill('Ja');await browserExpect(list.getByRole('option')).toHaveCount(1);
    expect(await formValue()).toEqual({country:'vn'});
    await input.press('ArrowDown');await input.press('Escape');
    await browserExpect(input).toHaveValue('Vietnam');
    await browserExpect(input).not.toHaveAttribute('aria-activedescendant',/.+/);
    await input.fill('United');await list.getByRole('option',{name:'United States'}).click();
    await browserExpect(input).toHaveValue('United States');await browserExpect(input).toBeFocused();
    await input.fill('Missing');await browserExpect(page.getByRole('status')).toHaveText('No results.');
    await input.press('Tab');await browserExpect(page.locator('#after')).toBeFocused();
    await browserExpect(input).toHaveValue('United States');
    await input.fill('United');
    await page.evaluate(()=>window.update({value:'vn'}));await browserExpect(input).toHaveValue('Vietnam');
    await browserExpect(input).toHaveAttribute('aria-expanded','false');
    await input.fill('Japan');await input.press('ArrowDown');await input.press('Enter');
    await browserExpect(input).toHaveValue('Vietnam');
    await page.evaluate(()=>{window.accept=true;});
    await input.fill('Japan');await input.press('ArrowDown');await input.press('Enter');
    await browserExpect(input).toHaveValue('Japan');expect(await formValue()).toEqual({country:'jp'});
    await input.fill('Viet');await input.press('ArrowDown');
    await page.evaluate(()=>window.update({options:[{value:'jp',label:'Japan'}]}));
    await browserExpect(input).not.toHaveAttribute('aria-activedescendant',/.+/);
    const before=await page.evaluate(()=>window.changes.length);
    await input.press('Enter');expect(await page.evaluate(()=>window.changes.length)).toBe(before);
    await input.press('Escape');
    await page.evaluate(options=>window.update({options}),options);
    await page.evaluate(()=>window.update({value:''}));await browserExpect(input).toHaveValue('');
    await input.fill('Unknown');expect(await input.evaluate(el=>el.checkValidity())).toBe(false);
    await input.press('Escape');
    await page.evaluate(()=>window.update({value:undefined}));
    await page.evaluate(()=>document.querySelector('form').reset());
    await browserExpect(input).toHaveValue('United States');expect(await formValue()).toEqual({country:'us'});
    await input.fill('Vietnam');await input.press('ArrowDown');await input.press('Enter');
    await page.evaluate(()=>{const form=document.querySelector('form');form.addEventListener('reset',event=>event.preventDefault(),{once:true});form.reset();});
    await browserExpect(input).toHaveValue('Vietnam');
    await input.click();await browserExpect(list).toBeVisible();
    await page.mouse.click(1000,650);await browserExpect(list).not.toBeVisible();
    await page.evaluate(()=>window.update({readonly:true}));await input.press('ArrowDown');
    await browserExpect(input).toHaveAttribute('aria-expanded','false');
    await page.evaluate(()=>window.update({readonly:false,disabled:true}));await browserExpect(input).toBeDisabled();expect(await formValue()).toEqual({});
    await page.evaluate(()=>{window.update({disabled:false});document.querySelector('fieldset').disabled=true;});
    await browserExpect(input).toBeDisabled();expect(await formValue()).toEqual({});
    await page.evaluate(()=>{document.querySelector('fieldset').disabled=false;});
    await input.focus();await input.press('ArrowDown');await browserExpect(list).toBeVisible();
    await page.evaluate(()=>{document.querySelector('fieldset').disabled=true;});
    await browserExpect(list).not.toBeVisible();await browserExpect(input).toHaveAttribute('aria-expanded','false');
    await page.evaluate(()=>{document.querySelector('fieldset').disabled=false;window.veto=true;});
    await input.focus();await input.press('ArrowDown');await browserExpect(input).toHaveAttribute('aria-expanded','false');
    expect(await page.evaluate(()=>window.native.every(id=>id==='country'))).toBe(true);
    await page.evaluate(()=>{window.veto=false;window.fresh();});
    await input.focus();await input.press('ArrowDown');await browserExpect(list).toBeVisible();
    await page.evaluate(()=>{document.querySelector('fieldset').disabled=true;});
    await browserExpect(list).not.toBeVisible();
    await page.evaluate(()=>window.unmount());
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
