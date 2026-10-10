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
import { ButtonGroup, Button, Separator, AspectRatio } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves native group behavior, joined borders, separator semantics and responsive ratio sizing', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-layout-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<input id="outside"><form><fieldset id="fields">\${component(ButtonGroup,{id:'group',label:'Actions',orientation:p.orientation??'horizontal',dir:p.dir??'ltr','@click':p.groupClick},html\`\${component(Button,{id:'one',type:'button',variant:'outline','@click':p.action},'One')}\${p.linkMiddle?html\`<a id="two" href="#destination" class="inline-flex items-center border border-input rounded-md h-9 px-3">Two</a>\`:component(Button,{id:'two',type:'button',variant:'outline',disabled:p.disabled,'@click':p.action},'Two')}\${component(Button,{id:'three',type:'button',variant:'outline','@click':p.action},'Three')}\`)}</fieldset></form><div style="width:320px">\${component(Separator,{id:'horizontal',decorative:p.decorative,'@click':p.hrClick})}</div><div style="display:flex;height:80px">\${component(Separator,{id:'vertical',orientation:'vertical',decorative:p.decorative,'@click':p.divClick})}</div><div style="width:640px">\${component(AspectRatio,{id:'media',ratio:p.ratio??16/9,style:'width:'+(p.width??320)+'px','data-owner':'cover','@click':p.mediaClick},html\`<button id="child" type="button" class="w-full h-full">Media</button>\`)}</div><button id="after">After</button><div id="destination">Destination</div>\``;
  const template=new Function('html','component','ButtonGroup','Button','Separator','AspectRatio',`return (${templateSource})`)(html,component,ButtonGroup,Button,Separator,AspectRatio);
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
import {ButtonGroup,Button,Separator,AspectRatio} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#group');
let props={};window.actions=0;window.submits=0;
function current(){return {...props,action:()=>window.actions++,groupClick:event=>window.groupTarget=event.currentTarget.tagName,hrClick:event=>window.hrTarget=event.currentTarget.tagName,divClick:event=>window.divTarget=event.currentTarget.tagName,mediaClick:event=>window.mediaTarget=event.currentTarget.tagName};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#group');container.addEventListener('submit',event=>{event.preventDefault();window.submits++;});
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

    const noJS=await browser.newContext({javaScriptEnabled:false}),staticPage=await noJS.newPage();await staticPage.goto(url);await browserExpect(staticPage.getByRole('group',{name:'Actions'})).toBeVisible();const staticBox=await staticPage.locator('#media').boundingBox();expect(staticBox.width).toBeCloseTo(320,0);expect(staticBox.height).toBeCloseTo(180,0);await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const group=page.getByRole('group',{name:'Actions'}),one=page.locator('#one'),two=page.locator('#two'),three=page.locator('#three'),outside=page.locator('#outside'),media=page.locator('#media');
    const radius=locator=>locator.evaluate(el=>{const s=getComputedStyle(el);return [s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius];});
    let first=await one.boundingBox(),middle=await two.boundingBox();expect(middle.x).toBeCloseTo(first.x+first.width-1,0);expect((await radius(one))[1]).toBe('0px');expect((await radius(one))[0]).not.toBe('0px');expect(await radius(two)).toEqual(['0px','0px','0px','0px']);expect((await radius(three))[0]).toBe('0px');expect((await radius(three))[1]).not.toBe('0px');
    await outside.focus();await page.keyboard.press('Tab');await browserExpect(one).toBeFocused();expect(await one.evaluate(el=>getComputedStyle(el).zIndex)).toBe('1');expect(await one.evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');await page.keyboard.press('ArrowRight');await browserExpect(one).toBeFocused();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.actions)).toBe(1);expect(await page.evaluate(()=>window.groupTarget)).toBe('DIV');await page.keyboard.press('Tab');await browserExpect(two).toBeFocused();await page.keyboard.press('Space');expect(await page.evaluate(()=>window.actions)).toBe(2);
    await page.evaluate(()=>window.update({dir:'rtl'}));first=await one.boundingBox();middle=await two.boundingBox();expect(middle.x+middle.width).toBeCloseTo(first.x+1,0);expect((await radius(one))[0]).toBe('0px');expect((await radius(one))[1]).not.toBe('0px');
    await page.evaluate(()=>window.update({orientation:'vertical',dir:'ltr'}));first=await one.boundingBox();middle=await two.boundingBox();expect(middle.y).toBeCloseTo(first.y+first.height-1,0);expect((await radius(one))[0]).not.toBe('0px');expect((await radius(one))[3]).toBe('0px');expect((await radius(three))[3]).not.toBe('0px');await browserExpect(group).toHaveAttribute('data-orientation','vertical');
    await page.evaluate(()=>window.update({orientation:'horizontal',disabled:true}));await browserExpect(two).toBeDisabled();await one.focus();await page.keyboard.press('Tab');await browserExpect(three).toBeFocused();await page.locator('#fields').evaluate(el=>el.disabled=true);await browserExpect(one).toBeDisabled();await one.evaluate(el=>el.click());expect(await page.evaluate(()=>window.actions)).toBe(2);await page.locator('#fields').evaluate(el=>el.disabled=false);
    await page.evaluate(()=>window.update({linkMiddle:true}));await browserExpect(two).toHaveAttribute('href','#destination');await two.click();expect(await page.evaluate(()=>location.hash)).toBe('#destination');expect((await radius(two))[0]).toBe('0px');
    expect(await page.getByRole('separator').count()).toBe(2);await browserExpect(page.locator('#vertical')).toHaveAttribute('aria-orientation','vertical');expect((await page.locator('#horizontal').boundingBox()).height).toBeCloseTo(1,0);expect((await page.locator('#vertical').boundingBox()).height).toBeCloseTo(80,0);await page.locator('#horizontal').evaluate(el=>el.click());await page.locator('#vertical').evaluate(el=>el.click());expect(await page.evaluate(()=>[window.hrTarget,window.divTarget])).toEqual(['HR','DIV']);
    await page.evaluate(()=>window.update({decorative:true}));expect(await page.getByRole('separator').count()).toBe(0);await browserExpect(page.locator('#horizontal')).toHaveAttribute('aria-hidden','true');await browserExpect(page.locator('#vertical')).toHaveAttribute('aria-hidden','true');await page.evaluate(()=>window.update({decorative:false}));expect(await page.getByRole('separator').count()).toBe(2);
    await browserExpect(media).toHaveAttribute('data-owner','cover');let box=await media.boundingBox();expect(box.width).toBeCloseTo(320,0);expect(box.height).toBeCloseTo(180,0);await page.locator('#child').click();expect(await page.evaluate(()=>window.mediaTarget)).toBe('DIV');await page.evaluate(()=>window.update({width:160,ratio:1}));box=await media.boundingBox();expect(box.width).toBeCloseTo(160,0);expect(box.height).toBeCloseTo(160,0);expect((await page.locator('#child').boundingBox()).height).toBeCloseTo(160,0);await page.evaluate(()=>window.update({ratio:2}));expect((await media.boundingBox()).height).toBeCloseTo(80,0);
    await page.evaluate(()=>{window.fresh();window.unmount();});expect(await page.getByRole('group').count()).toBe(0);await page.evaluate(()=>window.fresh());await one.click();expect(await page.evaluate(()=>window.actions)).toBe(3);expect(await page.evaluate(()=>window.submits)).toBe(0);expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
