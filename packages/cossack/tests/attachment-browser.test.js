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
import { Attachment } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('hydrates native Attachment actions, decorative previews and explicit localized status', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-attachment-'));
  let server, browser;
  const templateSource = `(p={})=>html\`<form @submit=\${p.submit}>
    <button id="before" type="button">Before</button><fieldset ?disabled=\${p.fieldsetDisabled??false}>
    \${p.removed?null:component(Attachment,{id:'attachment',name:p.name??'report.pdf',size:p.size??'2 MB',status:p.status??'Upload failed',statusVariant:p.statusVariant??'error',
      dir:p.dir,style:'max-width:'+(p.width??'280px'),class:'custom-card','data-root':'card','@click':p.root,
      thumbnail:p.thumbnail,thumbnailProps:{id:'preview',decoding:'async','@load':p.image,'@error':p.image,'data-preview':'file'},
      removeLabel:p.removeLabel,removeProps:{id:'remove','?disabled':p.disabled??false,'data-remove':'file','@click':p.directive?preventDefault(p.native,{novalidate:false}):p.native},onRemove:p.noRemove?undefined:p.remove})}
    </fieldset><button id="after" type="button">After</button></form>\``;
  const template = new Function('html','component','Attachment','preventDefault',`return ${templateSource}`)(html,component,Attachment,undefined);
  try {
    const scope=path.join(root,'node_modules','@cossackframework'); await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app">${minifyHtml(renderToString(template({remove:()=>{}}),{hydrate:true}))}</main><div id="extra"></div><script type="module" src="/main.js"></script></body></html>`);
    await fs.mkdir(path.join(root,'public'));
    await fs.writeFile(path.join(root,'public','preview.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>');
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component,preventDefault} from '@cossackframework/renderer';
import {Attachment} from '@cossackframework/ui';
const template=${templateSource};
const container=document.querySelector('#app'),initial=[...container.querySelectorAll('#attachment,#remove')];let props={};
window.actions=[];window.images=[];window.submits=0;
function current(){return {...props,
  submit:event=>{event.preventDefault();window.submits++;},
  root:event=>window.actions.push('root:'+event.currentTarget.tagName),
  native:event=>{window.actions.push('native:'+event.currentTarget.tagName);if(props.veto)event.preventDefault();if(props.disableInCallback)event.currentTarget.disabled=true;},
  remove:event=>{window.actions.push('remove:'+event.currentTarget.tagName);if(props.removeNow){props.removed=true;draw();document.querySelector('#after').focus();}},
  image:event=>window.images.push(event.type+':'+event.currentTarget.tagName)
};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);
hydrate(template(current()),container);window.retained=initial.every(element=>element.isConnected);window.ready=true;
`);
    const built = await build({ root, configFile: false, logLevel: 'silent', plugins:[tailwind()], build: { outDir: 'dist', emptyOutDir: true } });
    const chunks = (Array.isArray(built) ? built : [built]).flatMap(result => result.output).filter(chunk => chunk.type === 'chunk');
    const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
    expect(modules.some(id => id.includes('/parse5/') || id.endsWith('/ssr-form-values.js'))).toBe(false);
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); response.end(await fs.readFile(file)); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const url = `http://127.0.0.1:${server.address().port}`;

    const staticContext=await browser.newContext({javaScriptEnabled:false}),staticPage=await staticContext.newPage();
    await staticPage.goto(url);await browserExpect(staticPage.locator('.cs-attachment__name')).toHaveText('report.pdf');
    await browserExpect(staticPage.getByRole('button',{name:'Remove report.pdf'})).toHaveAttribute('type','button');
    await staticContext.close();
    const page=await browser.newPage({viewport:{width:360,height:600},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto(url); await page.waitForFunction(()=>window.ready);
    expect(await page.evaluate(()=>window.retained)).toBe(true);
    const card=page.locator('#attachment'),remove=page.getByRole('button',{name:'Remove report.pdf'}),status=card.locator('.cs-attachment__status');
    await browserExpect(card).toHaveClass(/custom-card/);await browserExpect(card).toHaveAttribute('data-root','card');
    await browserExpect(status).toHaveClass(/text-destructive/);await browserExpect(status).not.toHaveClass(/text-success/);
    await page.locator('#before').focus();await page.keyboard.press('Tab');await browserExpect(remove).toBeFocused();
    await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.actions)).toEqual(['native:BUTTON','remove:BUTTON','root:DIV']);
    await page.keyboard.press('Space');expect(await page.evaluate(()=>window.actions.filter(value=>value==='remove:BUTTON').length)).toBe(2);
    expect(await page.evaluate(()=>window.submits)).toBe(0);
    await page.evaluate(()=>{window.actions=[];window.update({veto:true});});await remove.click();
    expect(await page.evaluate(()=>window.actions)).toEqual(['native:BUTTON','root:DIV']);
    await page.evaluate(()=>{window.actions=[];window.update({veto:false,directive:true});});await remove.click();
    expect(await page.evaluate(()=>window.actions)).toEqual(['native:BUTTON','root:DIV']);await browserExpect(page.locator('form')).not.toHaveAttribute('novalidate');
    await page.evaluate(()=>{window.actions=[];window.update({directive:false,disabled:true});});await browserExpect(remove).toBeDisabled();
    await page.locator('#before').focus();await page.keyboard.press('Tab');await browserExpect(page.locator('#after')).toBeFocused();
    // Synthetic dispatch additionally checks the disabled handler guard; keyboard above is native.
    await remove.dispatchEvent('click');expect(await page.evaluate(()=>window.actions.some(value=>value.startsWith('remove:')))).toBe(false);
    await page.evaluate(()=>window.update({disabled:false,fieldsetDisabled:true}));await browserExpect(remove).toBeDisabled();
    await page.locator('#before').focus();await page.keyboard.press('Tab');await browserExpect(page.locator('#after')).toBeFocused();
    await page.evaluate(()=>{window.actions=[];window.update({fieldsetDisabled:false,disableInCallback:true});});await remove.click();
    expect(await page.evaluate(()=>window.actions)).toEqual(['native:BUTTON','root:DIV']);
    await page.evaluate(()=>window.update({disableInCallback:false,disabled:true}));await page.evaluate(()=>window.update({disabled:false}));
    await page.evaluate(()=>window.update({name:'設計資料.pdf',status:'完了',statusVariant:'success',removeLabel:'資料を削除'}));
    const localized=page.getByRole('button',{name:'資料を削除'});await browserExpect(localized).toBeVisible();await browserExpect(status).toHaveText('完了');await browserExpect(status).toHaveClass(/text-success/);
    await browserExpect(card.locator('.cs-attachment__name')).toHaveText('設計資料.pdf');
    await page.evaluate(()=>window.update({thumbnail:'/preview.svg'}));await browserExpect.poll(()=>page.evaluate(()=>window.images)).toContain('load:IMG');
    await browserExpect(page.locator('#preview')).toHaveAttribute('alt','');await browserExpect(page.locator('#preview')).toHaveAttribute('aria-hidden','true');
    await browserExpect(page.getByRole('img')).toHaveCount(0);
    await page.evaluate(()=>window.update({thumbnail:'/missing.svg'}));await browserExpect.poll(()=>page.evaluate(()=>window.images)).toContain('error:IMG');
    await browserExpect(card.locator('.cs-attachment__name')).toHaveText('設計資料.pdf');
    await page.evaluate(()=>window.update({thumbnail:undefined,dir:'rtl',width:'210px',name:'very-long-filename-without-spaces-or-breaks.pdf',size:'123456789012345678901234567890MB',status:'VeryLongLocalizedStatusWithoutSpaces'}));
    await browserExpect(page.locator('#preview')).toHaveCount(0);
    const bounds=await card.evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth,button:element.querySelector('button').getBoundingClientRect().left,icon:element.querySelector('.cs-attachment__icon').getBoundingClientRect().left}));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);expect(bounds.button).toBeLessThan(bounds.icon);
    expect(await localized.evaluate(element=>parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.00001);
    await localized.focus();await page.evaluate(()=>window.update({status:'Changed'}));await browserExpect(localized).toBeFocused();
    await page.evaluate(()=>window.update({removeNow:true}));await page.keyboard.press('Enter');await browserExpect(card).toHaveCount(0);await browserExpect(page.locator('#after')).toBeFocused();
    await page.evaluate(()=>window.update({removed:false,noRemove:true}));await browserExpect(card).toBeVisible();await browserExpect(card.locator('button')).toHaveCount(0);
    await page.evaluate(()=>window.unmount());await browserExpect(card).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
