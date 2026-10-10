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
import { Tooltip, HoverCard } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('keeps hover content describable, dismissible, hoverable and focus-safe', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-hover-'));
  let server,browser;
  const templateSource=`(tip={},card={})=>html\`<div id="clip" style="overflow:hidden;width:260px;height:60px;margin-top:100px;padding:16px">\${component(Tooltip,{id:'save-tip',label:'Save the current document',delay:80,closeDelay:60,...tip},html\`<button id="save" aria-describedby="save-tip">Save</button>\`)}</div>\${component(HoverCard,{id:'card',label:'Account details',delay:80,closeDelay:60,content:html\`<input autofocus aria-label="Card field"><a href="#account">Account</a>\`,...card},html\`<button id="card-trigger">Details</button>\`)}<button id="after" style="margin-left:400px">After</button>\``;
  const template=new Function('html','component','Tooltip','HoverCard',`return (${templateSource})`)(html,component,Tooltip,HoverCard);
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
import {Tooltip,HoverCard as BaseHoverCard} from '@cossackframework/ui';
class HoverCard extends BaseHoverCard {constructor(){super();window.card=this;}}
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#save'),initialTip=container.querySelector('#save-tip');
let tip={},card={};window.events=[];
function current(){return {...card,contentProps:{...card.contentProps,'@click':event=>window.events.push(event.currentTarget.id)}};}
function draw(){render(template(tip,current()),container);}
window.update=(nextTip,nextCard)=>{tip={...tip,...nextTip};card={...card,...nextCard};draw();};
hydrate(template(tip,current()),container);window.retained=initial===container.querySelector('#save')&&initialTip===container.querySelector('#save-tip');
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=()=>{window.unmount();tip={};card={};draw();};
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


    const noJS=await browser.newContext({javaScriptEnabled:false});const staticPage=await noJS.newPage();await staticPage.goto(url);await browserExpect(staticPage.locator('#save')).toHaveAccessibleDescription('Save the current document');await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const save=page.locator('#save'),tip=page.locator('#save-tip'),trigger=page.locator('#card-trigger'),card=page.locator('#card'),after=page.locator('#after');
    await save.focus();await browserExpect(tip).toBeVisible();await browserExpect(save).toBeFocused();await browserExpect(save).toHaveAccessibleDescription('Save the current document');
    await page.keyboard.press('Escape');await browserExpect(tip).not.toBeVisible();await page.evaluate(()=>window.update({'data-update':'yes'},{}));await page.waitForTimeout(150);await browserExpect(tip).not.toBeVisible();await browserExpect(save).toBeFocused();
    await after.focus();await save.hover();await browserExpect(tip).toBeVisible();
    const bounds=await tip.boundingBox(),clip=await page.locator('#clip').boundingBox();expect(bounds.y).toBeLessThan(clip.y+16);
    await tip.hover();await page.waitForTimeout(150);await browserExpect(tip).toBeVisible();await browserExpect(after).toBeFocused();
    await page.keyboard.press('Escape');await browserExpect(tip).not.toBeVisible();
    await page.mouse.move(1200,650);await page.evaluate(()=>window.update({delay:500},{}));await save.hover();await page.keyboard.press('Escape');await page.waitForTimeout(550);await browserExpect(tip).not.toBeVisible();
    await page.mouse.move(1200,650);await page.evaluate(()=>window.update({delay:80},{}));await save.hover();await browserExpect(tip).toBeVisible();await page.mouse.move(1200,650);await browserExpect(tip).not.toBeVisible();
    await trigger.focus();await browserExpect(card).toBeVisible();await browserExpect(trigger).toBeFocused();
    await page.keyboard.press('Tab');await browserExpect(page.getByLabel('Card field')).toBeFocused();await page.mouse.move(1200,650);await page.waitForTimeout(150);await browserExpect(card).toBeVisible();
    await page.keyboard.press('Escape');await browserExpect(card).not.toBeVisible();await browserExpect(trigger).toBeFocused();
    await after.focus();await trigger.hover();await browserExpect(card).toBeVisible();await browserExpect(after).toBeFocused();await card.hover();await page.waitForTimeout(150);await browserExpect(card).toBeVisible();
    await page.mouse.move(1200,650);await browserExpect(card).not.toBeVisible();await after.evaluate(el=>el.blur());await trigger.hover();await browserExpect(card).toBeVisible();expect(await page.evaluate(()=>document.activeElement===document.body)).toBe(true);
    await page.getByLabel('Card field').click();expect(await page.evaluate(()=>window.events)).toEqual(['card']);await page.keyboard.press('Tab');await browserExpect(page.getByRole('link',{name:'Account'})).toBeFocused();await page.keyboard.press('Tab');await browserExpect(after).toBeFocused();
    await page.mouse.move(1200,650);await browserExpect(card).not.toBeVisible();
    await page.evaluate(()=>window.card.show());await browserExpect(card).toBeVisible();await page.evaluate(()=>window.card.hide());await browserExpect(card).not.toBeVisible();await page.evaluate(()=>window.card.show());await browserExpect(card).toBeVisible();
    await page.evaluate(()=>window.update({}, {disabled:true}));await browserExpect(card).not.toBeVisible();await page.evaluate(()=>window.card.show());await browserExpect(card).not.toBeVisible();
    await page.evaluate(()=>window.update({}, {disabled:false,contentProps:{style:'width:2000px;height:2000px;'}}));await page.evaluate(()=>window.card.show());await browserExpect(card).toBeVisible();await browserExpect.poll(()=>card.evaluate(el=>el.offsetWidth)).toBe(1268);await browserExpect.poll(()=>card.evaluate(el=>el.offsetHeight)).toBe(708);
    await page.evaluate(()=>window.fresh());await after.focus();await page.evaluate(()=>window.update({delay:500},{}));await save.hover();await page.evaluate(()=>window.unmount());await page.waitForTimeout(550);await page.evaluate(()=>{window.card.show();window.card.hide();window.dispatchEvent(new Event('resize'));});
    await page.evaluate(()=>{window.fresh();window.unmount();window.fresh();});await save.focus();await browserExpect(tip).toBeVisible();
    await page.evaluate(()=>window.fresh());await after.focus();await trigger.hover();await browserExpect(card).toBeVisible();await page.getByLabel('Card field').click();await page.keyboard.press('Escape');await browserExpect(trigger).toBeFocused();await browserExpect(card).not.toBeVisible();
    await after.focus();await save.hover();await browserExpect(tip).toBeVisible();
    await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='foreground-dialog';dialog.innerHTML='<button>Foreground action</button>';document.body.append(dialog);dialog.showModal();});
    await browserExpect(page.getByRole('button',{name:'Foreground action'})).toBeFocused();
    expect(await tip.evaluate(el=>el.matches(':popover-open'))).toBe(true);
    await page.keyboard.press('Escape');await browserExpect(page.locator('#foreground-dialog')).not.toBeVisible();await browserExpect(tip).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
