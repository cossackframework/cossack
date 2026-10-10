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
import { Carousel } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('navigates Carousel slides with native scrolling, keyboard, RTL and stable focus', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-carousel-'));
  let server,browser;
  const templateSource = `(p={})=>{let slides=[{value:'a',label:'Alpha'},{value:'b',label:'Beta'},{value:'c',label:'Gamma'}].filter(slide=>!p.removeA||slide.value!=='a');if(p.empty)slides=[];if(p.reverse)slides.reverse();return html\`<form @submit=\${p.submit}><button type="button" id="before">Before</button>\${component(Carousel,{id:'gallery',label:'Example cards',slides:slides.map(slide=>({...slide,label:slide.label+(p.suffix??''),size:slide.value==='c'?p.lastSize:undefined,props:{'data-slide':slide.value,'@click':p.capture},content:html\`<div class="p-4 h-40 bg-muted"><label for=\${'edit-'+slide.value}>\${'Edit '+slide.label}</label><input id=\${'edit-'+slide.value} value="Text" ?disabled=\${p.disableInputs??false}><button type="button" @click=\${p.child}>\${slide.label+' action'}</button></div>\`})),dir:p.dir,style:'width:'+(p.width??'360px'),slideSize:p.slideSize,emptyLabel:p.emptyLabel,viewportProps:{'data-viewport':'slides','@keydown':p.key,'@scroll':p.capture},'data-root':'gallery','@click':p.capture,onValueChange:p.change})}<button type="button" id="after">After</button></form>\`};`;
  const template = new Function('html','component','Carousel',`return ${templateSource}`)(html,component,Carousel);
  try {
    const scope=path.join(root,'node_modules','@cossackframework'); await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app">${minifyHtml(renderToString(template(),{hydrate:true}))}</main><div id="extra"></div><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Carousel} from '@cossackframework/ui';
const mounted=Carousel.prototype.onMount;Carousel.prototype.onMount=function(){mounted.call(this);window.gallery=this;};
const template=${templateSource};
const container=document.querySelector('#app'),initial=[...container.querySelectorAll('#gallery,#gallery-viewport,[data-carousel-value],input')];let props={};
window.changes=[];window.targets=[];window.submits=0;window.childClicks=0;
function current(){return {...props,submit:event=>{event.preventDefault();window.submits++;},capture:event=>window.targets.push(event.currentTarget.tagName+'#'+event.currentTarget.id),key:event=>{if(props.cancelKey)event.preventDefault();},change:value=>window.changes.push(value??null),child:()=>window.childClicks++};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
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
      try { response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await fs.readFile(file)); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await launchBrowser();
    const url = `http://127.0.0.1:${server.address().port}`;

    const staticContext=await browser.newContext({javaScriptEnabled:false,viewport:{width:500,height:500}}),staticPage=await staticContext.newPage();await staticPage.goto(url);
    await staticPage.getByLabel('Edit Alpha',{exact:true}).focus();await staticPage.keyboard.press('Tab');await staticPage.keyboard.press('Tab');await browserExpect(staticPage.getByLabel('Edit Beta',{exact:true})).toBeFocused();
    expect(await staticPage.locator('#gallery-viewport').evaluate(el=>el.scrollLeft)).toBeGreaterThan(300);await staticContext.close();
    const page=await browser.newPage({viewport:{width:500,height:600},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.ready,undefined,{timeout:5000}).catch(error=>{throw new Error(errors.join('; ')||error.message);});expect(await page.evaluate(()=>window.retained)).toBe(true);
    expect(await page.evaluate(()=>{try{window.gallery.scrollToSlide('unknown');return null;}catch(error){return error.message;}})).toContain('existing slide');
    const region=page.getByRole('region',{name:'Example cards'}),viewport=page.locator('#gallery-viewport'),previous=region.getByRole('button',{name:'Previous slide'}),next=region.getByRole('button',{name:'Next slide'}),status=region.getByRole('status');
    const aligned=async value=>browserExpect.poll(()=>page.evaluate(value=>{const viewport=document.querySelector('#gallery-viewport').getBoundingClientRect(),slide=document.querySelector('[data-carousel-value="'+value+'"]').getBoundingClientRect();return Math.abs((viewport.left+viewport.right-slide.left-slide.right)/2);},value)).toBeLessThan(2);
    await browserExpect(viewport).toHaveAttribute('data-viewport','slides');await browserExpect(region).toHaveAttribute('data-root','gallery');await browserExpect(previous).toHaveAttribute('aria-disabled','true');await aligned('a');
    await page.getByLabel('Edit Alpha',{exact:true}).focus();await page.evaluate(()=>window.update({disableInputs:true}));await browserExpect(viewport).toBeFocused();await page.evaluate(()=>window.update({disableInputs:false}));
    await next.focus();await page.keyboard.press('Enter');await aligned('b');await browserExpect(next).toBeFocused();await browserExpect(status).toHaveText('2 / 3: Beta');
    await page.keyboard.press('Enter');await aligned('c');await browserExpect(next).toHaveAttribute('aria-disabled','true');await page.keyboard.press('Enter');await aligned('c');expect(await page.evaluate(()=>window.submits)).toBe(0);
    expect(await page.evaluate(()=>window.targets)).toContain('DIV#gallery');expect(await page.evaluate(()=>window.targets)).toContain('DIV#gallery-viewport');
    await viewport.focus();await page.keyboard.press('Home');await aligned('a');await page.keyboard.press('ArrowRight');await aligned('b');
    await page.getByLabel('Edit Beta',{exact:true}).focus();await page.keyboard.press('ArrowRight');await aligned('b');await browserExpect(page.getByLabel('Edit Beta',{exact:true})).toBeFocused();
    await page.getByRole('button',{name:'Beta action',exact:true}).click();expect(await page.evaluate(()=>window.childClicks)).toBe(1);expect(await page.evaluate(()=>window.targets)).toContain('DIV#gallery-slide-b');
    await viewport.focus();await page.evaluate(()=>window.update({cancelKey:true}));await page.keyboard.press('ArrowRight');await aligned('b');await page.evaluate(()=>window.update({cancelKey:false}));
    await page.evaluate(()=>window.update({dir:'rtl'}));await aligned('b');await viewport.focus();await page.keyboard.press('ArrowLeft');await aligned('c');await page.keyboard.press('Home');await aligned('a');
    await page.evaluate(()=>window.gallery.scrollToSlide('b'));await aligned('b');await page.evaluate(()=>window.update({width:'280px'}));await aligned('b');
    // Focus and selected identity survive reordering, then recover when a slide disappears.
    await page.evaluate(()=>window.update({dir:'ltr'}));await page.getByLabel('Edit Alpha',{exact:true}).focus();await aligned('a');
    await page.evaluate(()=>{window.savedInput=document.querySelector('#edit-a');window.update({reverse:true});});await aligned('a');await browserExpect(page.getByLabel('Edit Alpha',{exact:true})).toBeFocused();expect(await page.evaluate(()=>window.savedInput===document.querySelector('#edit-a'))).toBe(true);
    await page.evaluate(()=>window.update({removeA:true}));await browserExpect(viewport).toBeFocused();await aligned('b');await browserExpect(status).toHaveText('2 / 2: Beta');
    await page.evaluate(()=>window.update({empty:true}));await browserExpect(region.locator('[data-carousel-value]')).toHaveCount(0);await browserExpect(previous).toHaveAttribute('aria-disabled','true');await browserExpect(next).toHaveAttribute('aria-disabled','true');await browserExpect(status).toHaveText('No slides');expect(await page.evaluate(()=>window.changes.at(-1))).toBe(null);
    await page.evaluate(()=>window.update({emptyLabel:'Keine Karten'}));await browserExpect(status).toHaveText('Keine Karten');
    await page.evaluate(()=>window.update({empty:false,removeA:false,reverse:false}));await aligned('a');
    // Native manual scrolling updates controls and settled callbacks without a method call.
    await viewport.evaluate(el=>el.scrollTo({left:el.scrollWidth,behavior:'instant'}));await aligned('c');await browserExpect(status).toHaveText('3 / 3: Gamma');
    await page.emulateMedia({reducedMotion:'no-preference'});await viewport.focus();await page.keyboard.press('Home');await aligned('a');
    await page.evaluate(()=>{window.gallery.scrollNext();window.gallery.scrollNext();});await aligned('c');await browserExpect(status).toHaveText('3 / 3: Gamma');
    await page.evaluate(()=>{
      const viewport=document.querySelector('#gallery-viewport');
      window.gallery.scrollToSlide('a');viewport.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,button:0}));
      window.gallery.scrollToSlide('a');viewport.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaX:20}));
    });await aligned('c');await browserExpect(status).toHaveText('3 / 3: Gamma');
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{window.update({slideSize:'200px',width:'300px'});});await page.evaluate(()=>window.gallery.scrollToSlide('a'));await browserExpect(status).toHaveText('1 / 3: Alpha');
    await next.click();await browserExpect(status).toHaveText('2 / 3: Beta');expect(await viewport.evaluate(el=>Math.round(el.scrollLeft))).toBe(200);
    await next.click();await browserExpect(status).toHaveText('3 / 3: Gamma');await browserExpect(next).toHaveAttribute('aria-disabled','true');expect(await viewport.evaluate(el=>Math.abs(el.scrollLeft-(el.scrollWidth-el.clientWidth)))).toBeLessThan(2);
    await previous.click();await browserExpect(status).toHaveText('2 / 3: Beta');expect(await viewport.evaluate(el=>Math.round(el.scrollLeft))).toBe(200);
    await page.evaluate(()=>{window.update({dir:undefined});document.documentElement.dir='rtl';});await browserExpect.poll(()=>viewport.evaluate(el=>Math.round(Math.abs(el.scrollLeft)))).toBe(200);await next.click();await browserExpect(status).toHaveText('3 / 3: Gamma');await browserExpect(next).toHaveAttribute('aria-disabled','true');
    await page.evaluate(()=>window.update({lastSize:'250px'}));await browserExpect.poll(()=>region.locator('[data-carousel-value="c"]').evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(250);await browserExpect(next).toHaveAttribute('aria-disabled','true');
    await page.setViewportSize({width:900,height:600});await page.evaluate(()=>window.update({width:'700px'}));await browserExpect(previous).toHaveAttribute('aria-disabled','true');await browserExpect(next).toHaveAttribute('aria-disabled','true');await browserExpect(status).toHaveText('1 / 3: Alpha');
    await page.evaluate(()=>{window.update({slideSize:'100%',lastSize:undefined,width:'360px',dir:'ltr'});document.documentElement.removeAttribute('dir');});
    await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>{window.gallery.scrollToSlide('c');window.unmount();window.afterUnmount=window.changes.length;});await page.waitForTimeout(250);expect(await page.evaluate(()=>window.changes.length)).toBe(await page.evaluate(()=>window.afterUnmount));
    await page.evaluate(()=>window.fresh());await aligned('a');await next.click();await aligned('b');await browserExpect(status).toHaveText('2 / 3: Beta');const beforeRename=await page.evaluate(()=>window.changes.length);await page.evaluate(()=>window.update({suffix:' translated'}));await browserExpect(status).toHaveText('2 / 3: Beta translated');expect(await page.evaluate(()=>window.changes.length)).toBe(beforeRename);expect(errors).toEqual([]);

  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
