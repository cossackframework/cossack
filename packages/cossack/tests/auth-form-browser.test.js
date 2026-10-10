import { it, expect, vi } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { html, renderToString, minifyHtml } from '../../renderer/dist/server.js';
import { component } from '../../renderer/dist/index.js';
import { AuthForm } from '../../ui/dist/blocks/index.js';
import { UI_COMPONENTS } from '../src/templates/ui.js';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'));

it.each(['package', 'ejected'])('operates the %s AuthForm with native credentials and owned async work', async kind => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-auth-form-'));
  let server, browser;
  const source = `(p={})=>html\`<fieldset ?disabled=\${p.fieldsetDisabled??false}>\${component(AuthForm,{id:'account',onSubmit:p.submit??(()=>{}),onSocial:p.social??(()=>{}),providers:[{id:'company',label:'Company login'}],
    mode:p.mode,defaultMode:p.defaultMode,onModeChange:p.change,disabled:p.disabled,dir:p.dir,
    class:'custom', 'data-root':'account','@click':p.root,formProps:{'data-native':'form','@submit':p.native},labels:p.labels})}</fieldset>
    \${component(AuthForm,{id:'second',defaultMode:'signup',onSubmit:()=>{}})}<button id="outside" type="button">Outside</button>\``;
  const template = new Function('html','component','AuthForm',`return ${source}`)(html,component,AuthForm);
  try {
    const scope=path.join(root,'node_modules','@cossackframework'); await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{experimentalDecorators:true,useDefineForClassFields:false,target:'ES2022'}}));
    if(kind==='ejected') {
      const spy=vi.spyOn(process,'cwd').mockReturnValue(path.join(repository,'packages/framework'));
      try {await fs.writeFile(path.join(root,'AuthForm.ts'),UI_COMPONENTS['auth-form'].template());} finally {spy.mockRestore();}
    }
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app">${minifyHtml(renderToString(template(),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);\n@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};\n@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};\n@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';import {html,component,hydrate,render} from '@cossackframework/renderer';
import {AuthForm} from '${kind==='package'?'@cossackframework/ui/blocks':'./AuthForm.ts'}';
const template=${source},container=document.querySelector('#app');let props={};
window.calls=[];window.signals=[];window.events=[];window.modes=[];
const original=[...container.querySelectorAll('input')];
function request(kind,data,context){window.calls.push({kind,data});window.signals.push(context.signal);return new Promise((resolve,reject)=>{window.finish=resolve;window.fail=reject;});}
const current=()=>({...props,submit:(data,context)=>request('credentials',data,context),social:(id,context)=>request('social',id,context),
 change:mode=>window.modes.push(mode),root:event=>window.events.push('root:'+event.currentTarget.tagName),native:event=>{window.events.push('form:'+event.currentTarget.tagName);if(props.veto)event.preventDefault();}});
window.update=patch=>{props={...props,...patch};render(template(current()),container);};
window.unmount=()=>render(html\`<p>Unmounted</p>\`,container);
window.remount=()=>{props={};render(template(current()),container);};
hydrate(template(current()),container);window.retained=original.every(node=>node.isConnected);window.ready=true;
`);
    await build({root,configFile:false,logLevel:'silent',plugins:[tailwind()],build:{outDir:'dist',emptyOutDir:true}});
    server=createServer(async(request,response)=>{
      const pathname=new URL(request.url,'http://localhost').pathname;
      const file=path.resolve(root,'dist','.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(path.join(root,'dist')+path.sep)){response.writeHead(404);response.end();return;}
      try{response.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(await fs.readFile(file));}
      catch{response.writeHead(404);response.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});
    const url=`http://127.0.0.1:${server.address().port}`;
    const nojs=await browser.newContext({javaScriptEnabled:false}),staticPage=await nojs.newPage();await staticPage.goto(url);
    await browserExpect(staticPage.locator('#account').getByRole('button',{name:'Sign in',exact:true})).toBeDisabled();
    await browserExpect(staticPage.locator('#second').getByLabel('Name',{exact:true})).toHaveAttribute('id','second-name');
    await staticPage.locator('#account-email').fill('early@example.com');await staticPage.locator('#account-password').fill('short');
    await staticPage.locator('#account-password').press('Enter');expect(staticPage.url()).toBe(url+'/');
    await nojs.close();
    const page=await browser.newPage({viewport:{width:360,height:760}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    let release;const gate=new Promise(resolve=>{release=resolve;});await page.route('**/*.js',async route=>{await gate;await route.continue();});
    try {
      await page.goto(url,{waitUntil:'commit'});await page.locator('#account-email').fill('early@example.com');await page.locator('#account-password').fill('short');
      release();await page.waitForFunction(()=>window.ready);
    } finally {release();}
    expect(await page.evaluate(()=>window.retained)).toBe(true);
    const form=page.locator('#account-form'),rootForm=page.locator('#account'),email=page.locator('#account-email'),password=page.locator('#account-password');
    const submit=()=>rootForm.getByRole('button',{name:'Sign in',exact:true});
    await browserExpect(submit()).toBeEnabled();await browserExpect(email).toHaveValue('early@example.com');await browserExpect(password).toHaveValue('short');
    await rootForm.getByLabel('Show password',{exact:true}).click();await browserExpect(password).toHaveAttribute('type','text');await browserExpect(password).toHaveValue('short');
    await password.press('Enter');
    expect(await page.evaluate(()=>window.calls)).toEqual([{kind:'credentials',data:{mode:'login',email:'early@example.com',password:'short'}}]);
    await browserExpect(form).toHaveAttribute('aria-busy','true');await browserExpect(email).toBeDisabled();await browserExpect(page.locator('#second-email')).toBeEnabled();
    await form.evaluate(node=>node.requestSubmit());expect(await page.evaluate(()=>window.calls.length)).toBe(1);
    await page.evaluate(()=>window.finish({error:'Check your details',fieldErrors:{email:'Email is unavailable'}}));
    await browserExpect(email).toBeFocused();await browserExpect(email).toHaveAttribute('aria-describedby','account-email-error');
    await browserExpect(rootForm.getByRole('alert')).toHaveText('Check your details');
    await email.fill('new@example.com');await browserExpect(rootForm.getByRole('alert')).toBeEmpty();
    await page.evaluate(()=>window.update({veto:true}));await submit().click();expect(await page.evaluate(()=>window.calls.length)).toBe(1);
    await page.evaluate(()=>window.update({veto:false}));await submit().click();await page.evaluate(()=>window.fail(new Error('PRIVATE BACKEND DETAIL')));
    await browserExpect(rootForm.getByRole('alert')).toHaveText('Unable to complete this request. Please try again.');
    await browserExpect(rootForm).not.toContainText('PRIVATE BACKEND DETAIL');
    await rootForm.getByRole('button',{name:'Create an account instead'}).click();await browserExpect(page.locator('#account-name')).toBeVisible();
    await browserExpect(password).toHaveValue('short');await browserExpect(password).toHaveAttribute('autocomplete','new-password');
    await rootForm.getByRole('button',{name:'Create account',exact:true}).click();expect(await page.evaluate(()=>window.calls.length)).toBe(2);
    await password.fill('longer-password');await page.locator('#account-name').fill('Ada');await rootForm.getByRole('button',{name:'Create account',exact:true}).click();
    expect(await page.evaluate(()=>window.calls.at(-1).data)).toEqual({mode:'signup',email:'new@example.com',password:'longer-password',name:'Ada'});
    await page.evaluate(()=>{window.staleFinish=window.finish;window.update({mode:'login'});});
    await browserExpect(submit()).toBeEnabled();expect(await page.evaluate(()=>window.signals.at(-1).aborted)).toBe(true);
    await page.evaluate(()=>window.staleFinish({error:'Stale error'}));await browserExpect(rootForm.getByRole('alert')).toBeEmpty();
    await rootForm.getByRole('button',{name:'Create an account instead'}).click();await browserExpect(page.locator('#account-name')).toHaveCount(0);
    await rootForm.getByRole('button',{name:'Company login'}).press('Space');expect(await page.evaluate(()=>window.calls.at(-1))).toEqual({kind:'social',data:'company'});
    await page.evaluate(()=>window.finish());await browserExpect(submit()).toBeEnabled();
    await page.evaluate(()=>window.update({fieldsetDisabled:true}));await browserExpect(submit()).toBeDisabled();
    await page.evaluate(()=>window.update({fieldsetDisabled:false,dir:'rtl'}));await submit().click();
    await page.evaluate(()=>{window.staleFinish=window.finish;window.unmount();});expect(await page.evaluate(()=>window.signals.at(-1).aborted)).toBe(true);
    await page.evaluate(()=>{window.staleFinish({error:'Unmounted error'});window.remount();});
    await browserExpect(page.locator('#account-form')).toHaveAttribute('aria-busy','false');await browserExpect(submit()).toBeEnabled();
    await email.fill('autofill@example.com');
    // Password managers may update a value without firing input/change events.
    await password.evaluate(node=>{node.value='autofilled-secret';});await submit().click();
    expect(await page.evaluate(()=>window.calls.at(-1).data.password)).toBe('autofilled-secret');
    await page.locator('#outside').focus();await page.evaluate(()=>window.finish({fieldErrors:{email:'Please check'}}));
    await browserExpect(form).toHaveAttribute('aria-busy','false');await browserExpect(page.locator('#outside')).toBeFocused();
    expect(await page.evaluate(()=>window.events.includes('form:FORM')&&window.events.includes('root:DIV'))).toBe(true);
    expect(await page.evaluate(()=>new Set([...document.querySelectorAll('[id]')].map(node=>node.id)).size===document.querySelectorAll('[id]').length)).toBe(true);
    expect(errors).toEqual([]);
  } finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
},120000);
