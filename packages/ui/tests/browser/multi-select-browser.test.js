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
import { MultiSelect } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('hydrates accessible tags with keyboard editing, visible validation and repeated form values', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-multiselect-'));
  let server,browser;
  const templateSource=`(props={})=>html\`<form id="profile"><label for="skills">Skills</label><p id="skills-help">Choose skills</p><fieldset>\${component(MultiSelect,{id:'skills',name:'skills',options:['TypeScript','Rust','Go'],defaultValue:['TypeScript'],required:true,'aria-describedby':'skills-help',...props})}</fieldset><button type="button" id="after">After</button></form><form id="external"></form>\``;
  const template=new Function('html','component','MultiSelect',`return (${templateSource})`)(html,component,MultiSelect);
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
import {MultiSelect} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#skills');
let props={};window.changes=[];window.native=[];
const callbacks={onChange:values=>{window.changes.push([...values]);if(window.accept){props.value=values;draw();}},validate:value=>value===window.reject?'Not allowed':null,'@input':event=>window.native.push(event.currentTarget.id),'@keydown':event=>{if(window.veto)event.preventDefault();}};
function draw(){render(template({...props,...callbacks}),container);}
window.update=next=>{props={...props,...next};draw();};
hydrate(template(callbacks),container);window.retained=initial===container.querySelector('#skills');
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
    await browserExpect(initial.getByRole('combobox',{name:'Skills'})).toHaveValue('');
    await browserExpect(initial.getByRole('button',{name:'Remove TypeScript'})).toHaveCount(1);
    await browserExpect(initial.locator('input[type=hidden]')).toHaveValue('TypeScript');
    await noJS.close();
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
    await page.waitForFunction(()=>window.retained!==undefined);
    expect(await page.evaluate(()=>window.retained)).toBe(true);
    const input=page.getByRole('combobox',{name:'Skills'}),list=page.getByRole('listbox');
    const formValues=()=>page.evaluate(()=>new FormData(document.querySelector('form')).getAll('skills'));
    expect(await formValues()).toEqual(['TypeScript']);
    expect(await input.evaluate(el=>el.checkValidity())).toBe(true);
    await input.focus();await browserExpect(list).toBeVisible();
    expect(await page.locator('.cs-multiselect__field').evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');
    await browserExpect(list.getByRole('option')).toHaveCount(2);
    await input.press('ArrowDown');await browserExpect(input).toHaveAttribute('aria-activedescendant','skills-listbox-1');
    await input.press('Enter');await browserExpect(page.getByRole('button',{name:'Remove Rust'})).toBeVisible();
    expect(await formValues()).toEqual(['TypeScript','Rust']);await browserExpect(input).toBeFocused();
    const remove=page.getByRole('button',{name:'Remove TypeScript'});
    await remove.focus();await remove.press('Enter');
    await browserExpect(page.getByRole('button',{name:'Remove Rust'})).toBeFocused();
    expect(await formValues()).toEqual(['Rust']);
    await input.focus();await input.press('Backspace');
    await browserExpect(page.locator('.cs-multiselect__tag')).toHaveCount(0);
    expect(await input.evaluate(el=>el.checkValidity())).toBe(false);
    await browserExpect(page.getByRole('alert')).toHaveText('Select at least one value.');
    await input.fill('Go');expect(await input.evaluate(el=>el.checkValidity())).toBe(false);
    await page.evaluate(()=>{window.reject='Go';});
    await input.press('Enter');await browserExpect(page.getByRole('alert')).toHaveText('Not allowed');
    await browserExpect(input).toHaveAttribute('aria-describedby','skills-help skills-error');
    await browserExpect(input).toHaveAttribute('aria-invalid','true');expect(await formValues()).toEqual([]);
    await page.evaluate(()=>{window.reject=undefined;});
    await input.press('Enter');await browserExpect(page.getByRole('button',{name:'Remove Go'})).toBeVisible();
    await input.fill('  Cossack  ');await input.press('Enter');
    await browserExpect(page.getByRole('button',{name:'Remove Cossack'})).toBeVisible();
    expect(await formValues()).toEqual(['Go','Cossack']);
    await input.evaluate(el=>{el.value='Draft';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true}));});
    expect(await formValues()).toEqual(['Go','Cossack']);await browserExpect(input).toHaveValue('Draft');
    await input.press('Escape');
    await page.evaluate(()=>window.update({max:3}));
    await input.fill('Rust');await input.press('Enter');
    await input.fill('Extra');await input.press('Enter');
    await browserExpect(page.getByRole('alert')).toHaveText('Choose no more than 3 values.');
    expect(await formValues()).toEqual(['Go','Cossack','Rust']);
    await input.press('Escape');expect(await input.evaluate(el=>el.checkValidity())).toBe(true);
    await input.press('Backspace');await browserExpect(page.getByRole('button',{name:'Remove Rust'})).toHaveCount(0);
    await page.evaluate(()=>window.update({allowCreate:false}));
    await input.fill('Unknown');await input.press('Enter');expect(await formValues()).toEqual(['Go','Cossack']);
    await input.press('Escape');
    await page.evaluate(()=>window.update({value:['Rust']}));
    await browserExpect(page.locator('.cs-multiselect__tag')).toHaveCount(1);
    await input.fill('Go');await input.press('Enter');
    await browserExpect(page.locator('.cs-multiselect__tag')).toHaveCount(1);expect(await formValues()).toEqual(['Rust']);
    await page.evaluate(()=>{window.accept=true;});
    await input.fill('Go');await input.press('Enter');await browserExpect(page.locator('.cs-multiselect__tag')).toHaveCount(2);
    expect(await formValues()).toEqual(['Rust','Go']);
    await page.evaluate(()=>document.querySelector('form').reset());
    await browserExpect(page.locator('.cs-multiselect__tag')).toHaveCount(2);expect(await formValues()).toEqual(['Rust','Go']);
    await page.evaluate(()=>{window.accept=false;window.update({value:undefined});document.querySelector('form').reset();});
    await browserExpect(page.getByRole('button',{name:'Remove TypeScript'})).toBeVisible();expect(await formValues()).toEqual(['TypeScript']);
    await input.fill('Go');await input.press('Enter');
    await page.evaluate(()=>{const form=document.querySelector('form');form.addEventListener('reset',event=>event.preventDefault(),{once:true});form.reset();});
    await browserExpect(page.locator('.cs-multiselect__tag')).toHaveCount(2);
    await page.getByRole('button',{name:'Remove Go'}).click();await browserExpect(input).toBeFocused();
    await page.evaluate(()=>window.update({error:'Server rejected skills'}));
    await browserExpect(page.getByRole('alert')).toHaveText('Server rejected skills');expect(await input.evaluate(el=>el.checkValidity())).toBe(false);
    await page.evaluate(()=>window.update({error:undefined}));
    await browserExpect(page.getByRole('alert')).toHaveCount(0);expect(await input.evaluate(el=>el.checkValidity())).toBe(true);
    await page.evaluate(()=>window.update({form:'external'}));
    expect(await formValues()).toEqual([]);
    expect(await page.evaluate(()=>new FormData(document.querySelector('#external')).getAll('skills'))).toEqual(['TypeScript']);
    await input.fill('Rust');await input.press('Enter');
    await page.evaluate(()=>document.querySelector('#external').reset());
    await browserExpect(page.locator('.cs-multiselect__tag')).toHaveCount(1);
    expect(await page.evaluate(()=>new FormData(document.querySelector('#external')).getAll('skills'))).toEqual(['TypeScript']);
    await page.evaluate(()=>window.update({form:undefined,readonly:true}));
    await browserExpect(page.getByRole('button',{name:'Remove TypeScript'})).toBeDisabled();await input.press('Backspace');expect(await formValues()).toEqual(['TypeScript']);
    await page.evaluate(()=>window.update({readonly:false,disabled:true}));await browserExpect(input).toBeDisabled();expect(await formValues()).toEqual([]);
    await page.evaluate(()=>window.update({disabled:false}));await input.focus();await input.press('ArrowDown');await browserExpect(list).toBeVisible();
    await page.evaluate(()=>{document.querySelector('fieldset').disabled=true;});await browserExpect(list).not.toBeVisible();
    await browserExpect(input).toBeDisabled();await browserExpect(page.getByRole('button',{name:'Remove TypeScript'})).toBeDisabled();expect(await formValues()).toEqual([]);
    await page.evaluate(()=>{document.querySelector('fieldset').disabled=false;window.veto=true;});
    await input.focus();await input.press('Escape');
    // A vetoed removal key cannot modify the selection.
    await input.press('Backspace');expect(await formValues()).toEqual(['TypeScript']);
    expect(await page.evaluate(()=>window.native.every(id=>id==='skills'))).toBe(true);
    await page.evaluate(()=>{window.veto=false;window.fresh();});await input.focus();await browserExpect(list).toBeVisible();
    await page.evaluate(()=>{document.querySelector('fieldset').disabled=true;});await browserExpect(list).not.toBeVisible();
    await page.evaluate(()=>window.unmount());await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
