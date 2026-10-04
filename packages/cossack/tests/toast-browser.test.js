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
import { Toaster } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('owns Toast announcements, browser timers, focus and isolated presenter lifecycles', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-toast-'));
  let server,browser;
  const templateSource = `(p={})=>html\`<form @submit=\${p.submit}><button type="button" id="before">Before</button>\${component(Toaster,{id:'notifications',label:'Updates',dismissLabel:'Close notification','data-root':'toast-root','@click':p.capture,store:p.store})}<button type="button" id="after">After</button></form>\${p.secondary?component(Toaster,{id:'secondary',store:p.secondary,position:'top-left',label:'Other updates'}):null}\``;
  const template = new Function('html','component','Toaster',`return (${templateSource});`)(html,component,Toaster);
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
import {Toaster,toast,toastStore,createToastStore} from '@cossackframework/ui';
const template=${templateSource};
const container=document.querySelector('#app'),initial=document.querySelector('#notifications'),announcer=initial.querySelector('[role=status]');let props={};
window.toast=toast;window.store=toastStore;window.isolated=createToastStore();window.submits=0;window.targets=[];
function current(){return {...props,submit:event=>{event.preventDefault();window.submits++;},capture:event=>window.targets.push(event.currentTarget.id)};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
window.duplicate=()=>render(component(Toaster,{}),document.querySelector('#extra'));
window.removeExtra=()=>render(html\`<p>Removed extra</p>\`,document.querySelector('#extra'));
window.earlyCleanup=()=>{window.early=createToastStore();window.early.show('Early',{duration:1000});render(component(Toaster,{store:window.early}),document.querySelector('#extra'));window.removeExtra();};
hydrate(template(current()),container);window.retained=initial.isConnected&&announcer.isConnected;window.ready=true;
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

    const page=await browser.newPage({viewport:{width:320,height:700},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.ready,undefined,{timeout:5000}).catch(error=>{throw new Error(errors.join("; ")||error.message);});expect(await page.evaluate(()=>window.retained)).toBe(true);
    const region=page.getByRole('region',{name:'Updates',exact:true}),toasts=region.locator('[data-toast-id]');
    await browserExpect(region).toHaveAttribute('data-root','toast-root');await browserExpect(region.getByRole('status')).toHaveCount(1);await browserExpect(toasts).toHaveCount(0);
    await page.clock.install();
    await page.locator('#before').focus();
    await page.evaluate(()=>{window.toast.success('Saved', {duration:0});window.toast.warning('Review', {duration:0});});
    await browserExpect(toasts).toHaveCount(2);await browserExpect(page.locator('#before')).toBeFocused();await browserExpect(region.getByRole('status')).toHaveText('SavedReview');
    expect(await toasts.first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
    expect(await region.evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(320);
    await page.locator('#before').focus();await page.keyboard.press('Tab');await browserExpect(region.getByRole('button',{name:'Close notification: Saved',exact:true})).toBeFocused();
    await page.keyboard.press('Enter');await browserExpect(toasts).toHaveCount(1);await browserExpect(region.getByRole('button',{name:'Close notification: Review',exact:true})).toBeFocused();
    expect(await page.evaluate(()=>window.submits)).toBe(0);expect(await page.evaluate(()=>window.targets)).toContain('notifications');
    await page.keyboard.press('Escape');await browserExpect(toasts).toHaveCount(0);await browserExpect(page.locator('#before')).toBeFocused();
    await page.evaluate(()=>window.toast.show('Fallback',{duration:0}));await region.getByRole('button').focus();
    await page.evaluate(()=>document.querySelector('#before').disabled=true);await page.keyboard.press('Escape');await browserExpect(region).toBeFocused();
    await page.evaluate(()=>document.querySelector('#before').disabled=false);await page.locator('#after').focus();
    await page.evaluate(()=>window.duplicate());
    await browserExpect.poll(()=>errors.some(error=>error.includes('already has a mounted Toaster'))).toBe(true);
    errors.splice(errors.findIndex(error=>error.includes('already has a mounted Toaster')),1);
    await page.evaluate(()=>window.removeExtra());
    await page.evaluate(()=>window.earlyCleanup());await page.clock.runFor(1500);expect(await page.evaluate(()=>window.early.get().length)).toBe(1);
    await page.evaluate(()=>window.early.dispose());
    // A single mounted presenter owns countdowns; elapsed visible time survives pauses.
    await page.mouse.move(0,0);await page.evaluate(()=>window.toast.show('Timed',{duration:1000}));await browserExpect(toasts).toHaveCount(1);
    await page.clock.runFor(300);await region.getByRole('button').focus();await page.clock.runFor(2000);await browserExpect(toasts).toHaveCount(1);
    await page.locator('#after').focus();await page.clock.runFor(500);await browserExpect(toasts).toHaveCount(1);await page.clock.runFor(250);await browserExpect(toasts).toHaveCount(0);
    await page.evaluate(()=>window.toast.show('Hover',{duration:1000}));await browserExpect(toasts).toHaveCount(1);await toasts.first().hover();await page.clock.runFor(1500);await browserExpect(toasts).toHaveCount(1);
    await page.mouse.move(0,0);await page.clock.runFor(1100);await browserExpect(toasts).toHaveCount(0);
    await page.evaluate(()=>{window.toast.show('Background',{duration:1000});window.dispatchEvent(new Event('blur'));});await page.clock.runFor(2000);await browserExpect(toasts).toHaveCount(1);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.clock.runFor(1100);await browserExpect(toasts).toHaveCount(0);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.toast.show('Hidden',{duration:1000});});await page.clock.runFor(2000);await browserExpect(toasts).toHaveCount(1);
    await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(1100);await browserExpect(toasts).toHaveCount(0);
    // Isolated presenters do not share messages or duplicate announcements.
    await page.evaluate(()=>window.update({secondary:window.isolated}));await page.evaluate(()=>{window.isolated.show('Private',{duration:0});window.toast.show('Main',{duration:0});});
    await browserExpect(toasts).toHaveCount(1);await browserExpect(page.getByRole('region',{name:'Other updates'}).locator('[data-toast-id]')).toHaveText('Private');
    await page.evaluate(()=>window.isolated.dispose());await browserExpect(page.getByRole('region',{name:'Other updates'}).locator('[data-toast-id]')).toHaveCount(0);
    await page.evaluate(()=>{window.updates=0;window.stop=window.store.subscribe(()=>window.updates++);window.toast.show('Pending',{duration:1000});window.unmount();window.afterUnmount=window.updates;});
    expect(await page.evaluate(()=>window.store.get())).toEqual([]);await page.clock.runFor(5000);expect(await page.evaluate(()=>window.updates===window.afterUnmount)).toBe(true);
    await page.evaluate(()=>{window.toast.show('Queued',{duration:1000});});await page.clock.runFor(2000);expect(await page.evaluate(()=>window.store.get().length)).toBe(1);
    await page.evaluate(()=>window.fresh());await browserExpect(toasts).toHaveCount(1);await page.clock.runFor(1100);await browserExpect(toasts).toHaveCount(0);
    await page.evaluate(()=>window.stop());expect(errors).toEqual([]);

  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
