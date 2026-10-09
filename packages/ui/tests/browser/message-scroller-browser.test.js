import { launchBrowser, tailwind } from './helpers.js';
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const installedRoot = process.env.COSSACK_MESSAGE_SCROLLER_INSTALLED_ROOT;
const packageRoot = name => installedRoot ? path.join(installedRoot, 'node_modules/@cossackframework', name) : path.join(repository, 'packages', name);
async function publicEntry(name, subpath = '.') {
  const root = packageRoot(name);
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const declaration = metadata.exports[subpath];
  const entry = typeof declaration === 'string' ? declaration : declaration.import;
  if (typeof entry !== 'string') throw new Error(`Missing public import export ${name}${subpath}`);
  return import(pathToFileURL(path.resolve(root, entry)).href);
}
const { html, renderToString, minifyHtml } = await publicEntry('renderer', './server');
const { component, repeat } = await publicEntry('renderer');
const { MessageScroller } = await publicEntry('ui');
const require = createRequire(installedRoot ? path.join(installedRoot, 'package.json') : new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('owns transcript following, history anchors, native focus and cleanup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-message-scroller-'));
  let server, browser;
  const templateSource = `(p={})=>html\`<form @submit=\${p.submit}><button id="before" type="button">Before</button>
    \${component(MessageScroller,{id:'transcript',label:'Conversation',style:'height:'+(p.height??'280px')+';width:'+(p.width??'340px'),dir:p.dir,threshold:p.threshold??20,initialPosition:p.initialPosition,
      viewportProps:{'data-viewport':'messages','@scroll':p.capture,'@keydown':p.key},jumpProps:{'data-jump':'latest','@click':p.jump,'?disabled':p.disabled??false},jumpLabel:p.jumpLabel,'data-root':'transcript','@click':p.capture},
      repeat(p.ids??Array.from({length:20},(_,index)=>index),id=>id,id=>html\`<div data-row=\${id} style="min-height:80px;flex-shrink:0;overflow-wrap:anywhere"><p>\${'Message '+id} \${id===19?(p.text??'Text'):'Text'}</p><label for=\${'draft-'+id}>\${'Draft '+id}</label><input id=\${'draft-'+id} style="width:100%;min-width:0" value="Draft" ?disabled=\${p.disableInputs??false}>
        \${p.image&&id===1?html\`<img id="late-image" src="/large.svg" alt="" style="max-width:100%;height:auto">\`:null}</div>\`))}
    <button id="after" type="button">After</button></form>\``;
  const template = new Function('html','component','repeat','MessageScroller',`return ${templateSource}`)(html,component,repeat,MessageScroller);
  try {
    const scope=path.join(root,'node_modules','@cossackframework'); await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(packageRoot(name),path.join(scope,name),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app">${minifyHtml(renderToString(template(),{hydrate:true}))}</main><div id="extra"></div><script type="module" src="/main.js"></script></body></html>`);
    await fs.mkdir(path.join(root,'public'));
    await fs.writeFile(path.join(root,'public','large.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><rect width="300" height="180" fill="blue"/></svg>');
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(packageRoot('ui'),'src/theme/base.css'))};
@import ${JSON.stringify(path.join(packageRoot('ui'),'src/theme/theme.css'))};
@source ${JSON.stringify(path.join(packageRoot('ui'),'src'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component,repeat} from '@cossackframework/renderer';
import {MessageScroller} from '@cossackframework/ui';
window.liveObservers=new Set();
for(const name of ['ResizeObserver','MutationObserver']){const Native=window[name];window[name]=class extends Native{constructor(...args){super(...args);this.scroller=false;window.liveObservers.add(this);}observe(target,...options){this.scroller ||= !!target.matches?.('.cs-message-scroller__viewport,.cs-message-scroller__content');super.observe(target,...options);}disconnect(){super.disconnect();window.liveObservers.delete(this);}};}
const mounted=MessageScroller.prototype.onMount;MessageScroller.prototype.onMount=function(){mounted.call(this);window.transcript=this;};
const template=${templateSource};const container=document.querySelector('#app'),initial=[...container.querySelectorAll('#transcript,#transcript-viewport,[data-row],input')];let props={};
window.targets=[];window.submits=0;window.settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function current(){return {...props,submit:event=>{event.preventDefault();window.submits++;},capture:event=>window.targets.push(event.currentTarget.tagName+'#'+event.currentTarget.id),key:event=>{if(props.vetoKey)event.preventDefault();},jump:event=>{if(props.vetoJump)event.preventDefault();}};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=patch=>{window.unmount();props=patch??{};draw();};
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
    browser = await launchBrowser();
    const url = `http://127.0.0.1:${server.address().port}`;

    const staticContext=await browser.newContext({javaScriptEnabled:false}),staticPage=await staticContext.newPage();await staticPage.goto(url);
    await staticPage.locator('#before').focus();await staticPage.keyboard.press('Tab');await browserExpect(staticPage.getByRole('region',{name:'Conversation'})).toBeFocused();await staticPage.keyboard.press('End');
    await browserExpect.poll(()=>staticPage.locator('#transcript-viewport').evaluate(el=>el.scrollTop)).toBeGreaterThan(500);await staticContext.close();
    // Hold enhancement while a real user edits/scrolls the server-rendered content.
    const early=await browser.newPage({viewport:{width:450,height:700}});let release;
    const gate=new Promise(resolve=>{release=resolve;});await early.route('**/*.js',async route=>{await gate;await route.continue();});
    try {
      await early.goto(url,{waitUntil:'commit'});const earlyViewport=early.getByRole('region',{name:'Conversation'});
      await browserExpect(earlyViewport).toBeVisible();await early.locator('#draft-5').focus();await early.locator('#draft-5').fill('Before hydration');
      const top=await earlyViewport.evaluate(el=>el.scrollTop);release();await early.waitForFunction(()=>window.ready);
      await browserExpect(early.locator('#draft-5')).toBeFocused();await browserExpect(early.locator('#draft-5')).toHaveValue('Before hydration');
      await browserExpect.poll(()=>earlyViewport.evaluate(el=>el.scrollTop)).toBe(top);
    } finally {release();await early.close();}
    const page=await browser.newPage({viewport:{width:450,height:700},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.ready);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const vp=page.getByRole('region',{name:'Conversation'}),jump=page.getByRole('button',{name:'Scroll to latest messages'});
    const bottom=()=>browserExpect.poll(()=>vp.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(1);
    const anchor=()=>vp.evaluate(el=>{const top=el.getBoundingClientRect().top;const rows=[...el.querySelectorAll('[data-row]')].filter(row=>row.getBoundingClientRect().bottom>top&&row.getBoundingClientRect().top<top+el.clientHeight);return rows.map(row=>({id:row.dataset.row,offset:row.getBoundingClientRect().top-top}));});
    const anchored=entry=>browserExpect.poll(()=>vp.evaluate((el,entry)=>Math.abs(el.querySelector('[data-row="'+entry.id+'"]').getBoundingClientRect().top-el.getBoundingClientRect().top-entry.offset),entry)).toBeLessThan(1);
    await bottom();await browserExpect(jump).toHaveCount(0);await browserExpect(vp).toHaveAttribute('data-viewport','messages');
    const oldHeight=await vp.evaluate(el=>el.scrollHeight);await page.evaluate(()=>window.update({ids:Array.from({length:24},(_,i)=>i),text:'Streaming text '.repeat(100)}));await browserExpect.poll(()=>vp.evaluate(el=>el.scrollHeight)).toBeGreaterThan(oldHeight);await bottom();
    await vp.focus();await page.keyboard.press('Home');await browserExpect.poll(()=>vp.evaluate(el=>el.scrollTop)).toBeLessThan(1);await browserExpect(jump).toBeVisible();
    await page.evaluate(()=>window.update({vetoKey:true}));await page.keyboard.press('End');expect(await vp.evaluate(el=>el.scrollTop)).toBe(0);await page.evaluate(()=>window.update({vetoKey:false}));
    await vp.evaluate(el=>{el.scrollTop=650;});await browserExpect.poll(()=>page.evaluate(()=>window.targets.includes('DIV#transcript-viewport'))).toBe(true);
    const saved=(await anchor())[0];await page.evaluate(()=>window.update({ids:[-2,-1,...Array.from({length:24},(_,i)=>i)]}));await anchored(saved);
    await page.evaluate(()=>window.update({image:true}));await page.waitForFunction(()=>document.querySelector('#late-image')?.complete);await anchored(saved);
    await page.evaluate(()=>window.update({height:'220px',width:'290px',dir:'rtl'}));await anchored(saved);
    // Resize then remove the first visible row before another animation frame.
    // The fallback sibling must retain its current geometry, not a stale pre-resize offset.
    const visible=await page.evaluate(async()=>{
      window.update({width:'310px'});await Promise.resolve();
      const el=document.querySelector('#transcript-viewport'),top=el.getBoundingClientRect().top;
      const rows=[...el.querySelectorAll('[data-row]')].filter(row=>row.getBoundingClientRect().bottom>top&&row.getBoundingClientRect().top<top+el.clientHeight);
      const entries=rows.map(row=>({id:row.dataset.row,offset:row.getBoundingClientRect().top-top}));
      window.update({ids:[-2,-1,...Array.from({length:24},(_,i)=>i)].filter(value=>String(value)!==entries[0].id)});
      return entries;
    }),second=visible[1];await anchored(second);
    const focused=page.locator('#draft-'+second.id);await focused.focus();await focused.fill('Unsaved');const beforeFocused=(await anchor())[0];
    await page.evaluate(()=>window.update({ids:[-4,-3,-2,-1,...Array.from({length:24},(_,i)=>i)]}));await browserExpect(focused).toBeFocused();await browserExpect(focused).toHaveValue('Unsaved');await anchored(beforeFocused);
    await page.evaluate(()=>window.update({text:'More streaming text '.repeat(300)}));await browserExpect(focused).toBeFocused();await anchored(beforeFocused);
    await page.evaluate(id=>window.update({ids:[-4,-3,-2,-1,...Array.from({length:24},(_,i)=>i)].filter(value=>String(value)!==id)}),second.id);await browserExpect(vp).toBeFocused();
    const nextFocused=(await anchor())[0];await page.locator('#draft-'+nextFocused.id).focus();
    await page.evaluate(()=>window.update({disableInputs:true}));await browserExpect(vp).toBeFocused();await page.evaluate(()=>window.update({disableInputs:false}));
    const pausedTop=await vp.evaluate(el=>el.scrollTop);await page.evaluate(()=>window.update({disabled:true}));await browserExpect(jump).toBeDisabled();
    await jump.evaluate(el=>el.click());expect(await vp.evaluate(el=>el.scrollTop)).toBe(pausedTop);await page.evaluate(()=>window.update({disabled:false}));
    await page.evaluate(()=>window.update({vetoJump:true}));await jump.focus();await page.keyboard.press('Enter');await browserExpect(jump).toBeFocused();await browserExpect(jump).toBeVisible();
    await page.evaluate(()=>window.update({vetoJump:false,threshold:100000}));await browserExpect(jump).toHaveCount(0);await browserExpect(vp).toBeFocused();await page.evaluate(()=>window.update({threshold:20}));
    await jump.focus();await page.keyboard.press('Space');await bottom();await browserExpect(jump).toHaveCount(0);await browserExpect(vp).toBeFocused();expect(await page.evaluate(()=>window.submits)).toBe(0);
    // Real wheel input exits following before another append.
    await vp.hover();await page.mouse.wheel(0,-600);await browserExpect(jump).toBeVisible();const reading=(await anchor())[0];await page.evaluate(()=>window.update({ids:Array.from({length:30},(_,i)=>i)}));await anchored(reading);
    await page.evaluate(()=>window.transcript.scrollToBottom());await bottom();await page.evaluate(()=>window.update({ids:[]}));await browserExpect(vp.locator('[data-row]')).toHaveCount(0);await browserExpect(jump).toHaveCount(0);expect(await vp.evaluate(el=>el.scrollTop)).toBe(0);
    // A complete replacement without a surviving anchor clamps the old offset.
    await page.evaluate(()=>window.fresh({initialPosition:'start'}));await page.evaluate(()=>window.settle());await browserExpect.poll(()=>vp.evaluate(el=>el.scrollTop)).toBe(0);await vp.evaluate(el=>{el.scrollTop=400;});
    await browserExpect.poll(()=>vp.evaluate(el=>el.scrollTop)).toBe(400);await page.evaluate(()=>window.update({ids:Array.from({length:20},(_,i)=>i+100)}));await page.evaluate(()=>window.settle());await browserExpect.poll(()=>vp.evaluate(el=>el.scrollTop)).toBe(400);
    await page.evaluate(()=>window.update({ids:[100]}));await page.evaluate(()=>window.settle());await browserExpect.poll(()=>vp.evaluate(el=>el.scrollTop)).toBe(0);
    await page.evaluate(()=>window.update({ids:Array.from({length:20},(_,i)=>i+100)}));await page.evaluate(()=>window.settle());await browserExpect.poll(()=>vp.evaluate(el=>el.scrollTop)).toBe(0);await browserExpect(jump).toBeVisible();
    await page.locator('#draft-100').focus();await page.evaluate(()=>window.transcript.scrollToBottom());await bottom();await browserExpect(vp).toBeFocused();
    await page.evaluate(async()=>{window.oldTranscript=window.transcript;window.update({ids:[100]});await Promise.resolve();window.unmount();window.oldTranscript.scrollToBottom();});
    // Count observers targeting this component; Playwright also observes the document.
    await browserExpect(vp).toHaveCount(0);await browserExpect.poll(()=>page.evaluate(()=>[...window.liveObservers].filter(observer=>observer.scroller).length)).toBe(0);
    await page.evaluate(()=>window.fresh());await bottom();await browserExpect.poll(()=>page.evaluate(()=>[...window.liveObservers].filter(observer=>observer.scroller).length)).toBe(2);await page.evaluate(()=>window.unmount());await browserExpect.poll(()=>page.evaluate(()=>[...window.liveObservers].filter(observer=>observer.scroller).length)).toBe(0);
    await page.evaluate(()=>{window.fresh();window.unmount();});await browserExpect.poll(()=>page.evaluate(()=>[...window.liveObservers].filter(observer=>observer.scroller).length)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
