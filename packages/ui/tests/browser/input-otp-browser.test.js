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
import { InputOTP } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('hydrates one native OTP field and preserves editing, callbacks and form semantics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-otp-'));
  let server, browser;
  const templateSource = `(props={}) => html\`<form><label for="otp">Verification code</label><fieldset>\${component(InputOTP,{id:'otp',name:'code',length:4,defaultValue:'01',required:true,...props})}</fieldset></form>\``;
  const template = new Function('html','component','InputOTP', `return (${templateSource})`)(html,component,InputOTP);
  try {
    const scope = path.join(root, 'node_modules/@cossackframework');
    await fs.mkdir(scope, {recursive:true});
    for (const name of ['renderer','core','ui']) await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root, 'index.html'), `<html><body><main id="app">${minifyHtml(renderToString(template(), { hydrate: true }))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'), `
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root, 'main.js'), `
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {InputOTP} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('input');
window.events=[];let props={};
const callbacks={onValueChange:(code,event)=>{window.events.push(['change',code,event.currentTarget.id]);if(window.accept){props.value=code;update();}},onComplete:(code,event)=>window.events.push(['complete',code,event.currentTarget.id]),'@input':event=>window.events.push(['input',event.currentTarget.value,event.currentTarget.id]),'@paste':event=>{if(window.veto)event.preventDefault();}};
function update(){render(template({...props,...callbacks}),container);}
window.update=next=>{props={...props,...next};update();};
hydrate(template(callbacks),container);window.retained=initial===container.querySelector('input');
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
    await browserExpect(initial.getByRole('textbox',{name:'Verification code'})).toHaveValue('01');
    await noJS.close();
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
    await page.waitForFunction(()=>window.retained!==undefined);
    expect(await page.evaluate(()=>window.retained)).toBe(true);
    const input=page.getByRole('textbox',{name:'Verification code'});
    await browserExpect(page.getByRole('textbox')).toHaveCount(1);
    await browserExpect(input).toHaveAttribute('autocomplete','one-time-code');
    await input.focus();
    expect(await page.locator('.cs-input-otp__box').first().evaluate(el=>getComputedStyle(el).width)).toBe('44px');
    await page.keyboard.press('End');await page.keyboard.type('23');
    await browserExpect(input).toHaveValue('0123');
    await page.waitForFunction(()=>document.querySelectorAll('.cs-input-otp__box')[3].classList.contains('ring-[3px]'));
    expect(await page.locator('.cs-input-otp__box').nth(3).evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');
    // Pointer clicks place the caret in the visible slot through the overlaid input.
    const bounds=await page.locator('.cs-input-otp__box').nth(1).boundingBox();
    await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    expect(await input.evaluate(el=>el.selectionStart)).toBe(1);
    await page.keyboard.press('End');
    expect(await page.evaluate(()=>window.events.filter(e=>e[0]==='complete'))).toEqual([['complete','0123','otp']]);
    expect(await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('form'))))).toEqual({code:'0123'});
    expect(await input.evaluate(el=>el.checkValidity())).toBe(true);
    await page.keyboard.press('Backspace');await browserExpect(input).toHaveValue('012');
    expect(await input.evaluate(el=>el.checkValidity())).toBe(false);
    // Paste replaces the selection, strips separators, and keeps leading zeroes.
    await input.evaluate(el=>{el.setSelectionRange(0,3);const data=new DataTransfer();data.setData('text','0-987');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
    await browserExpect(input).toHaveValue('0987');
    await page.evaluate(()=>{window.veto=true;});
    await input.evaluate(el=>{el.select();const data=new DataTransfer();data.setData('text','1111');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
    await browserExpect(input).toHaveValue('0987');
    await page.evaluate(()=>document.querySelector('form').reset());
    await browserExpect(input).toHaveValue('01');
    await browserExpect(page.locator('.cs-input-otp__box')).toHaveText(['0','1','','']);
    await input.fill('8765');
    await page.evaluate(()=>{const form=document.querySelector('form');form.addEventListener('reset',event=>event.preventDefault(),{once:true});form.reset();});
    await browserExpect(input).toHaveValue('8765');
    // A controlled parent can reject edits or accept the proposed code.
    await page.evaluate(()=>window.update({value:'1234'}));await browserExpect(input).toHaveValue('1234');
    await input.fill('9999');await browserExpect(input).toHaveValue('1234');
    await page.evaluate(()=>{window.accept=true;});
    await input.fill('5678');await browserExpect(input).toHaveValue('5678');
    await page.evaluate(()=>window.update({value:'0000'}));await browserExpect(input).toHaveValue('0000');
    // Composition is left intact until its terminal event, even during a parent render.
    await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='12x';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
    await page.evaluate(()=>window.update({}));await browserExpect(input).toHaveValue('12x');
    await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await browserExpect(input).toHaveValue('12');
    await page.evaluate(()=>window.update({readonly:true}));
    await input.press('3');await browserExpect(input).toHaveValue('12');
    await page.evaluate(()=>{document.querySelector('fieldset').disabled=true;});
    await browserExpect(input).toBeDisabled();
    expect(await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('form'))))).toEqual({});
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
