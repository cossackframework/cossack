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
import { Field, Empty, Input, PasswordInput } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('links fields and preserves native empty-state actions through SSR, hydration and updates', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-field-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<input id="outside"><form id="form" @submit=\${p.submit}><fieldset ?disabled=\${p.disabled}>\${component(Field,{id:'email-field',label:'Email',for:p.controlId??'email',hint:p.hint??'Use work email',error:p.error,required:p.required??true,'@click':p.capture,control:attributes=>component(Input,{...attributes,name:'email',type:'email','.value':p.value??'person@example.com'})})}\${component(Field,{label:'Password',for:'password',hint:'Use a strong password',control:attributes=>component(PasswordInput,{...attributes,name:'password',value:'secret'})})}\${component(Empty,{id:'empty','data-kind':'search',class:'custom',title:'No matches',description:'Try another search','@click':p.capture,icon:html\`<span aria-hidden="true">?</span>\`},html\`<button id="clear" type="button" @click=\${p.action}>Clear</button><a id="help" href="#help-target">Help</a>\`)}<button id="submit" type="submit">Submit</button></fieldset></form><button id="after">After</button><div id="help-target">Help text</div>\``;
  const template=new Function('html','component','Field','Empty','Input','PasswordInput',`return (${templateSource})`)(html,component,Field,Empty,Input,PasswordInput);
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
import {Field,Empty,Input,PasswordInput} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#email');let props={};window.actions=0;window.submissions=0;window.targets=[];
function current(){return {...props,capture:event=>window.targets.push(event.currentTarget.tagName+'#'+event.currentTarget.id),action:()=>window.actions++,submit:event=>{event.preventDefault();window.submissions++;}};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#email');
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

    const noJS = await browser.newContext({javaScriptEnabled:false});
    const staticPage = await noJS.newPage();
    await staticPage.goto(url);
    await staticPage.locator('#email-field label').click();
    await browserExpect(staticPage.getByRole('textbox',{name:'Email',exact:true})).toBeFocused();
    await browserExpect(staticPage.locator('#email')).toHaveAccessibleDescription('Use work email');
    await staticPage.getByRole('link',{name:'Help'}).click();
    await browserExpect(staticPage).toHaveURL(/#help-target$/);
    await noJS.close();

    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.retained !== undefined);
    expect(await page.evaluate(() => window.retained)).toBe(true);
    const email = page.locator('#email'), password = page.locator('#password'), clear = page.locator('#clear');
    await browserExpect(email).toHaveAccessibleName('Email');
    await browserExpect(email).toHaveAccessibleDescription('Use work email');
    await browserExpect(password).toHaveAccessibleName('Password');
    await browserExpect(password).toHaveAccessibleDescription('Use a strong password');
    await browserExpect(email).toHaveAttribute('required','');
    await page.getByText('Password',{exact:true}).click();
    await browserExpect(password).toBeFocused();
    await page.keyboard.press('Tab');
    await browserExpect(page.getByRole('button',{name:'Show password'})).toBeFocused();
    await page.keyboard.press('Space');
    await browserExpect(password).toHaveAttribute('type','text');
    await page.keyboard.press('Tab');
    await browserExpect(clear).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.actions)).toBe(1);
    expect(await page.evaluate(() => window.submissions)).toBe(0);
    await page.keyboard.press('Tab');
    await browserExpect(page.locator('#help')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => location.hash)).toBe('#help-target');
    await email.fill('person@example.com');
    await page.evaluate(() => window.update({error:'Address is already used'}));
    await browserExpect(email).toBeFocused();
    await browserExpect(email).toHaveAccessibleDescription('Use work email Address is already used');
    await browserExpect(email).toHaveAttribute('aria-invalid','true');
    await browserExpect(email).toHaveAttribute('aria-describedby','email-hint email-error');
    await page.evaluate(() => window.update({error:undefined,hint:'',required:false}));
    await browserExpect(email).not.toHaveAttribute('aria-describedby');
    await browserExpect(email).not.toHaveAttribute('aria-invalid');
    await browserExpect(email).not.toHaveAttribute('required');
    expect(await page.locator('#email-hint, #email-error').count()).toBe(0);
    await browserExpect(email).toBeFocused();
    await page.evaluate(() => window.update({required:true}));
    await email.fill('');
    await page.locator('#submit').click();
    expect(await page.evaluate(() => window.submissions)).toBe(0);
    expect(await email.evaluate(el => el.validity.valueMissing)).toBe(true);
    await email.fill('valid@example.com');
    await page.locator('#submit').click();
    expect(await page.evaluate(() => window.submissions)).toBe(1);
    expect(await page.locator('#form').evaluate(el => Object.fromEntries(new FormData(el)))).toEqual({email:'valid@example.com',password:'secret'});
    await browserExpect(page.locator('#empty')).toHaveClass(/custom/);
    await browserExpect(page.locator('#empty')).toHaveAttribute('data-kind','search');
    await page.locator('#empty').click();
    await email.click();
    expect(await page.evaluate(() => window.targets)).toEqual(expect.arrayContaining(['DIV#empty','DIV#email-field']));
    await page.evaluate(() => window.update({disabled:true}));
    await browserExpect(email).toBeDisabled();
    await browserExpect(password).toBeDisabled();
    await browserExpect(clear).toBeDisabled();
    await page.locator('#outside').focus();
    await page.keyboard.press('Tab');
    await browserExpect(page.locator('#help')).toBeFocused();
    await page.evaluate(() => window.update({disabled:false,controlId:'renamed',hint:'New description'}));
    await page.locator('#email-field label').click();
    await browserExpect(page.locator('#renamed')).toBeFocused();
    await browserExpect(page.locator('#renamed')).toHaveAccessibleDescription('New description');
    expect(await page.locator('#email, #email-hint').count()).toBe(0);
    await page.evaluate(() => window.unmount());
    expect(await page.locator('.cs-field, .cs-empty').count()).toBe(0);
    await page.evaluate(() => window.fresh());
    await clear.click();
    expect(await page.evaluate(() => window.actions)).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
