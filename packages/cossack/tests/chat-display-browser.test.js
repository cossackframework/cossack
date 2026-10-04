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
import { Attachment, Bubble, Message, Marker, Avatar } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('composes native chat display controls with readable metadata, RTL and retained child focus', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-chat-display-'));
  let server, browser;
  const templateSource = `(p={})=>html\`<form @submit=\${p.submit}><button type="button" id="before">Before</button>
    <section id="scene" dir=\${p.dir??'ltr'} style=\${'width:'+(p.width??'320px')}>
      \${component(Marker,{id:'marker',variant:p.unread?'unread':'default','data-marker':'date','@click':p.capture},p.marker??'Today')}
      \${component(Bubble,{id:'standalone',variant:p.variant??'received',shape:p.shape??'default',time:p.time??'10:30 AM',datetime:p.datetime===null?undefined:(p.datetime??'10:30'),reactions:p.noReactions?[]:Array.from({length:p.many?12:2},(_,index)=>index%2?{emoji:'🎉',label:'Celebrate'}:{emoji:'👍',label:'Like',count:p.count??0}),reactionsLabel:p.reactionsLabel??'Reactions','data-bubble':'standalone','@click':p.capture},html\`<p>\${p.short?'Hi':'LongMessageWithoutSpaces'.repeat(8)}</p><label for="draft">Draft</label><input id="draft" style="width:100%;min-width:0" value="Text"><button type="button" id="reply" @click=\${p.reply}>Reply</button><a href="#after" id="link">Details</a>\`)}
      \${component(Message,{id:'message',name:p.name??'Alice',variant:p.variant??'received',time:p.time??'10:30 AM',datetime:p.datetime===null?undefined:(p.datetime??'10:30'),avatar:component(Avatar,{alt:'',size:28},'A'),'data-message':'row','@click':p.capture},component(Bubble,{id:'nested',variant:p.variant??'received','@click':p.capture},html\`<p>\${'NestedLongContentWithoutSpaces'.repeat(8)}</p>\${component(Attachment,{name:'design-document-with-a-very-long-name.pdf',status:'Available',size:'2 MB'})}\`))}
      <p id="following">Following message</p>
    </section><button type="button" id="after">After</button></form>\``;
  const template = new Function('html','component','Bubble','Message','Marker','Attachment','Avatar',`return ${templateSource}`)(html,component,Bubble,Message,Marker,Attachment,Avatar);
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
import {Bubble,Message,Marker,Attachment,Avatar} from '@cossackframework/ui';
const template=${templateSource};
const container=document.querySelector('#app'),initial=[...container.querySelectorAll('#standalone,#marker,#message,#draft')];let props={};
window.targets=[];window.replies=0;window.submits=0;
function current(){return {...props,submit:event=>{event.preventDefault();window.submits++;},capture:event=>window.targets.push(event.currentTarget.tagName+'#'+event.currentTarget.id),reply:()=>window.replies++};}
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

    const staticContext=await browser.newContext({javaScriptEnabled:false}),staticPage=await staticContext.newPage();await staticPage.goto(url);
    await browserExpect(staticPage.locator('#message .cs-message__name')).toHaveText('Alice');await browserExpect(staticPage.getByRole('list',{name:'Reactions'})).toBeVisible();await staticContext.close();
    const page=await browser.newPage({viewport:{width:400,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.ready);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const standalone=page.locator('#standalone'),body=standalone.locator('.cs-bubble__body'),content=standalone.locator('.cs-bubble__content'),message=page.locator('#message'),marker=page.locator('#marker'),draft=page.locator('#draft');
    await browserExpect(standalone).toHaveAttribute('data-bubble','standalone');await browserExpect(message).toHaveAttribute('data-message','row');await browserExpect(marker).toHaveAttribute('data-marker','date');
    const reactions=page.getByRole('list',{name:'Reactions'});await browserExpect(reactions.getByRole('listitem')).toHaveCount(2);await browserExpect(reactions.locator('.cs-bubble__reaction').first()).toContainText('0');
    const snapshot=await reactions.ariaSnapshot();expect(snapshot).toContain('Like');expect(snapshot).toContain('Celebrate');expect(snapshot).not.toContain('👍');
    await browserExpect(standalone.locator('time')).toHaveAttribute('datetime','10:30');await browserExpect(message.locator('time')).toHaveAttribute('datetime','10:30');
    await marker.click();expect(await page.evaluate(()=>window.targets)).toContain('DIV#marker');
    await page.locator('#before').focus();await page.keyboard.press('Tab');await browserExpect(draft).toBeFocused();await draft.fill('Unsaved draft');await page.keyboard.press('Tab');await browserExpect(page.locator('#reply')).toBeFocused();await page.keyboard.press('Enter');await page.keyboard.press('Space');expect(await page.evaluate(()=>window.replies)).toBe(2);expect(await page.evaluate(()=>window.submits)).toBe(0);expect(await page.evaluate(()=>window.targets)).toContain('DIV#standalone');
    await page.keyboard.press('Tab');await browserExpect(page.locator('#link')).toBeFocused();await page.keyboard.press('Enter');await browserExpect(page).toHaveURL(/#after$/);
    await page.locator('#nested p').click();expect(await page.evaluate(()=>window.targets)).toContain('DIV#nested');expect(await page.evaluate(()=>window.targets)).toContain('DIV#message');
    const geometry=()=>page.evaluate(()=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect(),b=rect('#standalone .cs-bubble__body'),root=rect('#standalone'),nested=rect('#nested .cs-bubble__body'),m=rect('#message .cs-message__body');
      return {ratio:b.width/root.width,nestedRatio:nested.width/m.width,left:b.left-root.left,right:root.right-b.right,overflow:document.querySelector('#scene').scrollWidth-document.querySelector('#scene').clientWidth,
        reactionBottom:rect('#standalone .cs-bubble__reactions').bottom,timeTop:rect('#standalone .cs-bubble__time').top,followingTop:rect('#following').top,messageBottom:rect('#message').bottom};
    });
    let layout=await geometry();expect(layout.ratio).toBeCloseTo(.75,2);expect(layout.nestedRatio).toBeCloseTo(1,2);expect(layout.left).toBeLessThan(1);expect(layout.overflow).toBeLessThanOrEqual(1);expect(layout.reactionBottom).toBeLessThanOrEqual(layout.timeTop);expect(layout.messageBottom).toBeLessThanOrEqual(layout.followingTop);
    for (const dir of ['ltr','rtl']) for(const variant of ['sent','received']) {
      await draft.focus();await page.evaluate(props=>window.update(props),{dir,variant,width:'220px',name:'LongSenderNameWithoutSpaces'.repeat(3),time:'Just now',datetime:null,unread:true,marker:'LongLocalizedDayMarkerWithoutSpaces'.repeat(3)});
      await browserExpect(draft).toBeFocused();await browserExpect(draft).toHaveValue('Unsaved draft');await browserExpect(message.locator('.cs-message__name')).toBeVisible();await browserExpect(message.locator('.cs-message__avatar')).toBeVisible();await browserExpect(message.locator('.cs-message__time')).toHaveText('Just now');await browserExpect(page.locator('#scene time')).toHaveCount(0);
      layout=await geometry();expect(layout.overflow).toBeLessThanOrEqual(1);expect(layout.nestedRatio).toBeCloseTo(1,2);expect(layout[(variant==='sent')===(dir==='ltr')?'right':'left']).toBeLessThan(1);
      const corners=await content.evaluate(element=>({left:parseFloat(getComputedStyle(element).borderBottomLeftRadius),right:parseFloat(getComputedStyle(element).borderBottomRightRadius)}));
      expect(corners[(variant==='sent')===(dir==='ltr')?'right':'left']).toBeLessThan(corners[(variant==='sent')===(dir==='ltr')?'left':'right']);
      const order=await message.evaluate(element=>({avatar:element.querySelector('.cs-message__avatar').getBoundingClientRect().left,body:element.querySelector('.cs-message__body').getBoundingClientRect().left}));
      if((variant==='sent')===(dir==='ltr'))expect(order.avatar).toBeGreaterThan(order.body);else expect(order.avatar).toBeLessThan(order.body);
    }
    await page.evaluate(()=>window.update({shape:'pill',reactionsLabel:'Réactions',count:4,many:true}));await browserExpect(page.getByRole('list',{name:'Réactions'}).getByRole('listitem').first()).toContainText('4');await browserExpect(draft).toBeFocused();
    await browserExpect(page.getByRole('list',{name:'Réactions'}).getByRole('listitem')).toHaveCount(12);
    expect(await standalone.locator('ul').evaluate(element=>element.getBoundingClientRect().height)).toBeGreaterThan(30);
    layout=await geometry();expect(layout.overflow).toBeLessThanOrEqual(1);expect(layout.reactionBottom).toBeLessThanOrEqual(layout.timeTop);
    await page.evaluate(()=>window.update({shape:'square',noReactions:true}));await browserExpect(standalone.locator('ul')).toHaveCount(0);await browserExpect(draft).toBeFocused();
    await page.evaluate(()=>window.unmount());await browserExpect(standalone).toHaveCount(0);expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
