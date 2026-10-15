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
import { Accordion, Collapsible } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves disclosure identity, native activation, state and focus', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-disclosures-'));
  let server,browser;
  const templateSource=`(a={},c={},disabled=false)=>html\`<form id="form"><fieldset ?disabled=\${disabled}>\${component(Accordion,{id:'section',summary:'Details',...a},html\`<input aria-label="Accordion field"><button type="button">Content action</button>\`)}\${component(Collapsible,{id:'more',trigger:'More',defaultOpen:true,...c},html\`<input aria-label="More field"><div id="growing">Content</div>\`)}<button type="button" id="after">After</button></fieldset></form>\``;
  const template=new Function('html','component','Accordion','Collapsible',`return (${templateSource})`)(html,component,Accordion,Collapsible);
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
import {Accordion,Collapsible} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#section-trigger');
let a={},c={},disabled=false;window.events=[];window.accept=false;window.veto=false;window.submits=0;
function props(name,value){return {...value,onOpenChange:open=>{window.events.push([name,open]);if(window.accept){if(name==='a')a={...a,open};else c={...c,open};draw();}},'@click':event=>window.events.push(['root',event.currentTarget.id]),triggerProps:{'@click':event=>{window.events.push(['trigger',event.currentTarget.id]);if(window.veto)event.preventDefault();}},panelProps:{'data-panel':name}};}
function draw(){render(template(props('a',a),props('c',c),disabled),container);}
window.update=(name,next)=>{if(name==='a')a={...a,...next};else c={...c,...next};draw();};window.disable=value=>{disabled=value;draw();};
hydrate(template(props('a',a),props('c',c),disabled),container);window.retained=initial===container.querySelector('#section-trigger');
container.addEventListener('submit',event=>{event.preventDefault();window.submits++;});
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=()=>{window.unmount();a={};c={};disabled=false;draw();};
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

    const noJS=await browser.newContext({javaScriptEnabled:false});const staticPage=await noJS.newPage();await staticPage.goto(url);await browserExpect(staticPage.locator('#section-trigger')).toHaveAttribute('aria-expanded','false');await browserExpect(staticPage.locator('#section-panel')).toHaveAttribute('inert','');await browserExpect(staticPage.getByLabel('More field')).toBeVisible();await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const a=page.locator('#section-trigger'),c=page.locator('#more-trigger'),ap=page.locator('#section-panel'),cp=page.locator('#more-panel');
    await browserExpect(page.getByRole('heading',{name:'Details'})).toHaveAttribute('aria-level','3');await browserExpect(a).toHaveAttribute('aria-controls','section-panel');await browserExpect(c).toHaveAttribute('aria-controls','more-panel');
    await a.focus();await page.keyboard.press('Tab');await browserExpect(c).toBeFocused();await a.focus();await page.keyboard.press('Enter');await browserExpect(a).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Tab');await browserExpect(page.getByLabel('Accordion field')).toBeFocused();
    await page.evaluate(()=>window.update('a',{open:false}));await browserExpect(a).toBeFocused();await browserExpect(ap).toHaveAttribute('inert','');await a.click();await browserExpect(a).toHaveAttribute('aria-expanded','false');expect(await page.evaluate(()=>window.events.filter(e=>e[0]==='a').at(-1))).toEqual(['a',true]);
    await page.evaluate(()=>{window.accept=true;window.veto=true;});const before=await page.evaluate(()=>window.events.filter(e=>e[0]==='a').length);await a.click();expect(await page.evaluate(()=>window.events.filter(e=>e[0]==='a').length)).toBe(before);await browserExpect(a).toHaveAttribute('aria-expanded','false');
    // A parent rejects a proposal by re-rendering with its own value; until then the next toggle builds on the pending one.
    await page.evaluate(()=>{window.veto=false;window.update('a',{});});await a.focus();await page.keyboard.press('Space');await browserExpect(a).toHaveAttribute('aria-expanded','true');await page.getByRole('button',{name:'Content action',exact:true}).click();await browserExpect(a).toHaveAttribute('aria-expanded','true');expect(await page.evaluate(()=>window.events.some(e=>e[0]==='root'&&e[1]==='section'))).toBe(true);
    await page.evaluate(()=>window.update('c',{defaultOpen:false}));await browserExpect(c).toHaveAttribute('aria-expanded','true');await page.getByLabel('More field').focus();await page.evaluate(()=>window.update('c',{open:false}));await browserExpect(c).toBeFocused();await browserExpect(cp).toHaveAttribute('aria-hidden','true');
    await page.evaluate(()=>window.update('c',{disabled:true}));await browserExpect(c).toBeDisabled();await c.click({force:true});await browserExpect(c).toHaveAttribute('aria-expanded','false');await page.evaluate(()=>window.update('c',{disabled:false}));
    await page.evaluate(()=>window.disable(true));await browserExpect(a).toBeDisabled();await browserExpect(c).toBeDisabled();await c.click({force:true});await browserExpect(c).toHaveAttribute('aria-expanded','false');await page.evaluate(()=>window.disable(false));
    await c.focus();await page.keyboard.press('Enter');await browserExpect(c).toHaveAttribute('aria-expanded','true');await browserExpect.poll(()=>cp.evaluate(el=>getComputedStyle(el).overflow)).toBe('visible');await page.locator('#growing').evaluate(el=>el.style.height='500px');expect(await cp.evaluate(el=>el.offsetHeight)).toBeGreaterThan(500);
    await page.emulateMedia({reducedMotion:'reduce'});await c.click();await browserExpect(c).toHaveAttribute('aria-expanded','false');expect(await cp.evaluate(el=>el.getAnimations().length)).toBe(0);await c.click();await browserExpect(c).toHaveAttribute('aria-expanded','true');
    expect(await page.evaluate(()=>window.submits)).toBe(0);await page.evaluate(()=>window.unmount());await page.evaluate(()=>window.fresh());await a.focus();await page.keyboard.press('Space');await browserExpect(a).toHaveAttribute('aria-expanded','true');expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
