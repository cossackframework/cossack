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
import { Avatar, AvatarGroup } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('recovers source-owned avatars and preserves named keyed groups across layout changes', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-avatar-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<input id="outside">\${component(Avatar,{id:'avatar',alt:p.alt??'Alice Person',src:p.src??'/bad.svg',size:p.size??40,style:'opacity:0.75',onImageLoad:p.loaded,onImageError:p.failed,'@click':p.capture})}\${component(Avatar,{id:'decorative',alt:''},'?')}<div dir=\${p.dir??'ltr'}>\${component(AvatarGroup,{id:'group',label:'Team',items:p.items??[{value:'a',alt:'Alice',src:'/good.svg'},{value:'b',alt:'Bob',src:'/bad.svg'},{value:'c',alt:'Carol'}],max:p.max??2,direction:p.direction??'row',size:36,'@click':p.capture})}</div><button id="after">After</button>\``;
  const template=new Function('html','component','Avatar','AvatarGroup',`return (${templateSource})`)(html,component,Avatar,AvatarGroup);
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
import {Avatar,AvatarGroup} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#avatar');let props={};window.actions=0;window.targets=[];window.loads=[];window.failures=[];window.beforeHydrationComplete=container.querySelector('#avatar img').complete;
function current(){return {...props,capture:event=>window.targets.push(event.currentTarget.tagName+'#'+event.currentTarget.id),action:()=>window.actions++,loaded:event=>window.loads.push(event.currentTarget.tagName),failed:event=>window.failures.push(event.currentTarget.tagName)};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#avatar');
`);
    const built = await build({ root, configFile: false, logLevel: 'silent', plugins:[tailwind()], build: { outDir: 'dist', emptyOutDir: true } });
    const chunks = (Array.isArray(built) ? built : [built]).flatMap(result => result.output).filter(chunk => chunk.type === 'chunk');
    const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
    expect(modules.some(id => id.includes('/parse5/') || id.endsWith('/ssr-form-values.js'))).toBe(false);
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/good.svg') { response.setHeader('content-type','image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>'); return; }
      if (pathname === '/bad.svg') { response.writeHead(404); response.end('missing'); return; }
      // Force cached failure before hydration to exercise the complete/naturalWidth path.
      if (pathname.endsWith('.js')) await new Promise(resolve => setTimeout(resolve, 200));
      const file = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await fs.readFile(file)); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await launchBrowser();
    const url = `http://127.0.0.1:${server.address().port}`;

    const noJS=await browser.newContext({javaScriptEnabled:false}), staticPage=await noJS.newPage();
    await staticPage.goto(url);
    await browserExpect(staticPage.locator('#avatar')).toHaveAccessibleName('Alice Person');
    await browserExpect(staticPage.locator('#decorative')).toHaveAttribute('aria-hidden','true');
    await browserExpect(staticPage.getByRole('group',{name:'Team'})).toBeVisible();
    await noJS.close();
    const page=await browser.newPage(), errors=[];
    page.on('pageerror', error=>errors.push(error.message)); await page.goto(url);
    await page.waitForFunction(()=>window.retained!==undefined);
    expect(await page.evaluate(()=>window.retained)).toBe(true);
    expect(await page.evaluate(()=>window.beforeHydrationComplete)).toBe(true);
    const avatar=page.locator('#avatar');
    await browserExpect(avatar.locator('.cs-avatar__fallback')).toHaveText('AP');
    await browserExpect(avatar).toHaveAccessibleName('Alice Person');
    expect((await avatar.boundingBox()).width).toBeCloseTo(40,0);
    expect(await avatar.evaluate(el=>getComputedStyle(el).opacity)).toBe('0.75');
    await page.locator('#outside').focus(); await page.keyboard.press('Tab'); await browserExpect(page.locator('#after')).toBeFocused();
    await page.evaluate(()=>window.update({src:'/good.svg'}));
    await browserExpect.poll(()=>avatar.locator('img').evaluate(el=>el.complete && el.naturalWidth>0)).toBe(true);
    expect(await page.evaluate(()=>window.loads)).toContain('IMG');
    await page.evaluate(()=>{window.oldImage=document.querySelector('#avatar img');window.failureCountBeforeStale=window.failures.length;window.update({src:'/good.svg?new'});});
    await page.evaluate(()=>window.oldImage.dispatchEvent(new Event('error')));
    expect(await page.evaluate(()=>window.failures.length)).toBe(await page.evaluate(()=>window.failureCountBeforeStale));
    await browserExpect.poll(()=>avatar.locator('img').evaluate(el=>el.complete && el.naturalWidth>0)).toBe(true);
    expect(await avatar.locator('.cs-avatar__fallback').count()).toBe(0);
    await page.evaluate(()=>window.update({src:'/bad.svg?retry'}));
    await browserExpect(avatar.locator('.cs-avatar__fallback')).toHaveText('AP');
    expect(await page.evaluate(()=>window.failures)).toContain('IMG');
    await page.evaluate(()=>window.update({src:'/good.svg',alt:'New Name',size:48}));
    await browserExpect.poll(()=>avatar.locator('img').evaluate(el=>el.complete && el.naturalWidth>0)).toBe(true);
    await browserExpect(avatar).toHaveAccessibleName('New Name');
    expect((await avatar.boundingBox()).width).toBeCloseTo(48,0);
    await avatar.click(); expect(await page.evaluate(()=>window.targets)).toContain('SPAN#avatar');
    await page.evaluate(()=>window.update({src:'',alt:''}));
    await browserExpect(avatar).toHaveAttribute('aria-hidden','true'); await browserExpect(avatar).not.toHaveAttribute('role'); await browserExpect(avatar).not.toHaveAttribute('aria-label');
    const group=page.locator('#group'), a=group.locator('[data-value="a"]'), b=group.locator('[data-value="b"]');
    await browserExpect(b.locator('.cs-avatar__fallback')).toHaveText('B');
    await browserExpect(group.locator('.sr-only')).toHaveText('1 more people');
    await page.evaluate(()=>{window.nodeA=document.querySelector('[data-value="a"]');window.nodeB=document.querySelector('[data-value="b"]');window.update({items:[{value:'b',alt:'Bob',src:'/bad.svg'},{value:'a',alt:'Alice',src:'/good.svg'},{value:'c',alt:'Carol'}]});});
    expect(await page.evaluate(()=>window.nodeA===document.querySelector('[data-value="a"]') && window.nodeB===document.querySelector('[data-value="b"]'))).toBe(true);
    await browserExpect(b.locator('.cs-avatar__fallback')).toHaveText('B'); expect(await a.locator('img').count()).toBe(1);
    for (const [dir,direction,sign] of [['ltr','row',1],['rtl','row',-1],['ltr','row-reverse',-1],['rtl','row-reverse',1]]) {
      await page.evaluate(({dir,direction})=>window.update({dir,direction}),{dir,direction});
      const first=await b.boundingBox(),second=await a.boundingBox(); expect(second.x-first.x).toBeCloseTo(sign*27,0);
    }
    await group.click(); expect(await page.evaluate(()=>window.targets)).toContain('DIV#group');
    await page.evaluate(()=>window.update({max:0})); expect(await group.locator('.cs-avatar-group__item').count()).toBe(0); await browserExpect(group.locator('.sr-only')).toHaveText('3 more people');
    await page.evaluate(()=>window.update({items:[]})); expect(await group.locator('.cs-avatar-group__overflow').count()).toBe(0);
    await page.evaluate(()=>{window.update({src:'/bad.svg?pending'});window.unmount();}); expect(await page.locator('.cs-avatar').count()).toBe(0);
    await page.evaluate(()=>window.fresh()); await browserExpect(avatar.locator('.cs-avatar__fallback')).toHaveText('AP');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
