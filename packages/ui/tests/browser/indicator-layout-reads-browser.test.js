import { launchBrowser, standardStyle, tailwind } from './helpers.js';
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

// A page re-renders its Tabs and ToggleGroups on every keystroke in a field next to them.
// Placing the indicator reads offsets, which lays out the whole page: only a change of
// the selected item, or of the tabs, may do that; a resize is the observer's to handle.
it('reads no layout for the indicator when a re-render keeps the selection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-indicator-'));
  let server, browser;
  try {
    const scope = path.join(root, 'node_modules/@cossackframework'); await fs.mkdir(scope, { recursive: true });
    for (const name of ['renderer', 'core', 'ui']) await fs.symlink(path.join(repository, 'packages', name), path.join(scope, name), 'dir');
    await fs.writeFile(path.join(root, 'index.html'), `<html><head><meta charset="utf-8"></head><body><main id="app"></main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root, 'style.css'), standardStyle());
    await fs.writeFile(path.join(root, 'main.js'), `
import './style.css';
import {html,render,component} from '@cossackframework/renderer';
import {Tabs,ToggleGroup} from '@cossackframework/ui';
window.reads=0;
for(const name of ['offsetLeft','offsetTop','offsetWidth','offsetHeight']){
  const descriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,name);
  Object.defineProperty(HTMLElement.prototype,name,{...descriptor,get(){window.reads++;return descriptor.get.call(this);}});
}
let state={tab:'a',align:'left',label:'Second',text:'',dir:'ltr'};
const draw=()=>render(html\`<input id="text" .value=\${state.text}>\${component(Tabs,{id:'tabs',label:'Views',variant:'underline',dir:state.dir,value:state.tab,items:[{value:'a',label:'First',content:html\`<p>\${state.text}</p>\`},{value:'b',label:state.label,content:'B'}]})}\${component(ToggleGroup,{label:'Alignment',dir:state.dir,value:state.align,items:[{value:'left',label:'Left'},{value:'right',label:'Right'}]})}\`,document.querySelector('#app'));
window.update=next=>{state={...state,...next};draw();};
draw();
window.ready=true;
`);
    await build({ root, configFile: false, logLevel: 'silent', plugins: [tailwind()], build: { outDir: 'dist', emptyOutDir: true } });
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await fs.readFile(file)); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await launchBrowser();
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    const tabIndicator = page.locator('#tabs .cs-tabs__indicator'), toggleIndicator = page.locator('.cs-toggle-group__indicator');
    const tab = value => page.locator(`#tabs [role=tab][data-value=${value}]`), toggle = value => page.locator(`.cs-toggle-group [data-value=${value}]`);
    const under = async (indicator, target) => Math.abs((await indicator.boundingBox()).x - (await target.boundingBox()).x) < 1 && Math.abs((await indicator.boundingBox()).width - (await target.boundingBox()).width) < 1;
    await browserExpect.poll(() => under(tabIndicator, tab('a'))).toBe(true);
    await browserExpect.poll(() => under(toggleIndicator, toggle('left'))).toBe(true);
    // Let the first placement and the observer's first callbacks settle.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const reads = await page.evaluate(async () => {
      window.reads = 0;
      for (const text of ['a', 'ab', 'abc', 'abcd', 'abcde']) { window.update({ text }); await Promise.resolve(); await Promise.resolve(); }
      return window.reads;
    });
    expect(reads).toBe(0);
    await browserExpect(page.locator('#tabs [role=tabpanel] p')).toHaveText('abcde');

    // A new selection moves the indicators.
    await page.evaluate(() => window.update({ tab: 'b', align: 'right' }));
    await browserExpect.poll(() => under(tabIndicator, tab('b'))).toBe(true);
    await browserExpect.poll(() => under(toggleIndicator, toggle('right'))).toBe(true);
    // A wider label resizes its tab: the observer follows it without a selection change.
    await page.evaluate(() => window.update({ label: 'A much longer second label' }));
    await browserExpect.poll(() => under(tabIndicator, tab('b'))).toBe(true);
    // Right to left moves the items without resizing them.
    await page.evaluate(() => window.update({ dir: 'rtl' }));
    await browserExpect.poll(() => under(tabIndicator, tab('b'))).toBe(true);
    await browserExpect.poll(() => under(toggleIndicator, toggle('right'))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
});
