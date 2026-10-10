import { launchBrowser } from './helpers.js';
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
import { Textarea, Select, NativeSelect, InputGroup, PasswordInput } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('serves native values without JS and hydrates controls with typed UI controls', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-form-ssr-'));
  let server, browser;
  const value = '\n<&" </textarea><script>alert(1)</script>';
  const templateSource = `(message, choice, disabled=false) => html\`<form>
    <label for="message">Message</label>\${component(Textarea,{id:'message',name:'message',required:true,disabled,'.value':message,'@input':event=>window.controlEvents.push(event.currentTarget.tagName)})}
    <label for="choice">Choice</label>\${component(Select,{id:'choice',name:'choice',required:true,disabled,'.value':choice,'@change':event=>window.controlEvents.push(event.currentTarget.tagName)},html\`
      <optgroup label="Choices > more"><option selected value="a">A</option>
        \${['b&c', 'd'].map(v => html\`<option value=\${v}>\${v}</option>\`)}
      </optgroup>\`)}
    <label for="native">Native choice</label>\${component(NativeSelect,{id:'native',name:'native',required:true,disabled,'.value':choice,'@change':event=>window.controlEvents.push(event.currentTarget.tagName)},html\`
      \${['a','b&c','d'].map(v => html\`<option value=\${v}>\${v}</option>\`)}\`)}
    <label for="ssr-password">SSR password</label>\${component(PasswordInput,{id:'ssr-password',name:'addonPassword',value:message?'initial-secret':'',autocomplete:'new-password',disabled,required:true})}
    <label for="ssr-amount">SSR amount</label>\${component(InputGroup,{id:'ssr-amount',name:'addonAmount',type:'number','.value':12,prefix:'$',disabled})}
  </form>\``;
  const template = new Function('html','component','Textarea','Select','NativeSelect','InputGroup','PasswordInput', `return (${templateSource})`)(html,component,Textarea,Select,NativeSelect,InputGroup,PasswordInput);
  try {
    const scope = path.join(root, 'node_modules/@cossackframework');
    await fs.mkdir(scope, {recursive:true});
    for (const name of ['renderer','core','ui']) await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root, 'index.html'), `<html><body><main id="app">${minifyHtml(renderToString(template(value, 'b&c'), { hydrate: true }))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root, 'main.js'), `
import {html,hydrate,render,component,renderToString} from '@cossackframework/renderer';
import {Textarea,Select,NativeSelect,InputGroup,PasswordInput} from '@cossackframework/ui';
const template=${templateSource};
try { renderToString(html\`<p>Example</p>\`); } catch(error) { window.ssrError=error.message; }
window.controlEvents=[];
const container=document.querySelector('#app');
const textarea=container.querySelector('textarea'),select=container.querySelector('select');
const options=[...select.options], password=container.querySelector('#ssr-password'),amount=container.querySelector('#ssr-amount');
hydrate(template(${JSON.stringify(value)},'b&c'),container);
window.retained=password===container.querySelector('#ssr-password')&&amount===container.querySelector('#ssr-amount')&&textarea===container.querySelector('textarea')&&select===container.querySelector('select')&&options.every((o,i)=>o===select.options[i]);
window.update=()=>render(template('Updated','d'),container);
window.disable=()=>render(template('Updated','d',true),container);
window.empty=()=>render(template('',''),container);
`);
    const built = await build({ root, configFile: false, logLevel: 'silent', build: { outDir: 'dist', emptyOutDir: true } });
    const chunks = (Array.isArray(built) ? built : [built]).flatMap(result => result.output).filter(chunk => chunk.type === 'chunk');
    const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
    expect(modules.some(id => id.includes('/parse5/') || id.endsWith('/ssr-form-values.js'))).toBe(false);
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html'); response.end(await fs.readFile(file)); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await launchBrowser();
    const url = `http://127.0.0.1:${server.address().port}`;
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const initial = await noJS.newPage();
    await initial.goto(url);
    await browserExpect(initial.getByRole('textbox', { name: 'Message' })).toHaveValue(value);
    await browserExpect(initial.getByRole('combobox', { name: 'Choice', exact:true })).toHaveValue('b&c');
    await browserExpect(initial.getByRole('combobox', {name:'Native choice',exact:true})).toHaveValue('b&c');
    await browserExpect(initial.getByLabel('SSR password',{exact:true})).toHaveValue('initial-secret');
    await browserExpect(initial.getByLabel('SSR password',{exact:true})).toHaveAttribute('type','password');
    await browserExpect(initial.getByLabel('SSR password',{exact:true})).toHaveAttribute('autocomplete','new-password');
    await browserExpect(initial.getByRole('spinbutton',{name:'SSR amount',exact:true})).toHaveValue('12');
    await noJS.close();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'warning') errors.push(message.text()); });
    await page.goto(url);
    expect(errors).toEqual([]);
    await page.waitForFunction(() => window.retained !== undefined);
    expect(await page.evaluate(() => window.retained)).toBe(true);
    expect(await page.evaluate(() => window.ssrError)).toContain('@cossackframework/renderer/server');
    await browserExpect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(value);
    expect(await page.evaluate(() => Object.fromEntries(new FormData(document.querySelector('form'))))).toEqual({ message: value, choice: 'b&c', native:'b&c',addonPassword:'initial-secret',addonAmount:'12' });
    await page.evaluate(() => window.update());
    await browserExpect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('Updated');
    await browserExpect(page.getByRole('combobox', { name: 'Choice', exact:true })).toHaveValue('d');
    await browserExpect(page.getByRole('combobox', {name:'Native choice',exact:true})).toHaveValue('d');
    await page.getByRole('combobox', {name:'Native choice',exact:true}).focus();
    await page.keyboard.press('ArrowUp');
    await browserExpect(page.getByRole('combobox', {name:'Native choice',exact:true})).toHaveValue('b&c');
    await page.getByRole('textbox',{name:'Message'}).fill('Typed notes');
    await page.getByRole('combobox',{name:'Choice',exact:true}).focus();
    await page.keyboard.press('ArrowUp');
    await browserExpect(page.getByRole('combobox',{name:'Choice',exact:true})).toHaveValue('b&c');
    expect(await page.evaluate(()=>window.controlEvents)).toEqual(['SELECT','TEXTAREA','SELECT']);
    const passwordControl=page.getByLabel('SSR password',{exact:true});
    await passwordControl.fill('hydrated-secret');
    await page.getByRole('button',{name:'Show password',exact:true}).click();
    await browserExpect(passwordControl).toHaveAttribute('type','text');
    await browserExpect(passwordControl).toHaveValue('hydrated-secret');
    await browserExpect(passwordControl).toBeFocused();
    await page.evaluate(()=>window.empty());
    expect(await page.evaluate(()=>document.querySelector('form').checkValidity())).toBe(false);
    await page.evaluate(()=>window.disable());
    await browserExpect(page.getByRole('textbox',{name:'Message'})).toBeDisabled();
    await browserExpect(page.getByRole('combobox',{name:'Choice',exact:true})).toBeDisabled();
    await browserExpect(page.getByRole('combobox',{name:'Native choice',exact:true})).toBeDisabled();
    expect(await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('form'))))).toEqual({});
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
