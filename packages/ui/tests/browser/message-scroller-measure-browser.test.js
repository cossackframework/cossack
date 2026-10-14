import { launchBrowser, tailwind, repository, toolRequire, standardStyle } from './helpers.js';
import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

const { build } = await import(toolRequire.resolve('vite'));

// A long transcript must not read the layout of every row, or the same rows
// again, while the reader only scrolls. Rows are measured again after a resize.
it('measures MessageScroller rows at most once per frame and only after geometry changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-scroller-measure-'));
  let server, browser;
  try {
    const scope = path.join(root, 'node_modules', '@cossackframework');
    await fs.mkdir(scope, { recursive: true });
    for (const name of ['renderer', 'core', 'ui']) await fs.symlink(path.join(repository, 'packages', name), path.join(scope, name), 'dir');
    await fs.writeFile(path.join(root, 'index.html'), '<html><head><meta charset="utf-8"></head><body><main id="app"></main><script type="module" src="/main.js"></script></body></html>');
    await fs.writeFile(path.join(root, 'style.css'), standardStyle());
    await fs.writeFile(path.join(root, 'main.js'), `
import './style.css';
import {html,render,component,repeat} from '@cossackframework/renderer';
import {MessageScroller} from '@cossackframework/ui';
const stats={reads:new Map(),passes:0,passesThisFrame:0,maxPassesPerFrame:0,reconciles:0,scrolls:0};window.stats=stats;
const native=Element.prototype.getBoundingClientRect;window.nativeRect=element=>native.call(element);
Element.prototype.getBoundingClientRect=function(){if(this.matches('[data-row]'))stats.reads.set(this.dataset.row,(stats.reads.get(this.dataset.row)??0)+1);return native.call(this);};
const measure=MessageScroller.prototype.measureAnchors;MessageScroller.prototype.measureAnchors=function(){stats.passes++;stats.passesThisFrame++;return measure.call(this);};
const reconcile=MessageScroller.prototype.reconcile;MessageScroller.prototype.reconcile=function(){stats.reconciles++;return reconcile.call(this);};
const mounted=MessageScroller.prototype.onMount;MessageScroller.prototype.onMount=function(){mounted?.call(this);window.transcript=this;};
(function frame(){stats.maxPassesPerFrame=Math.max(stats.maxPassesPerFrame,stats.passesThisFrame);stats.passesThisFrame=0;requestAnimationFrame(frame);})();
window.resetStats=()=>{stats.reads.clear();stats.passes=0;stats.maxPassesPerFrame=0;stats.reconciles=0;stats.scrolls=0;};
window.snapshot=()=>({rowsRead:stats.reads.size,maxReadsPerRow:Math.max(0,...stats.reads.values()),passes:stats.passes,maxPassesPerFrame:stats.maxPassesPerFrame,reconciles:stats.reconciles,scrolls:stats.scrolls});
window.settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
// Cached anchors must equal a fresh measurement of the same rows.
window.anchorError=()=>{const vp=document.querySelector('#transcript-viewport'),top=window.nativeRect(vp).top+vp.clientTop;
  return Math.max(...window.transcript.anchors.map(anchor=>Math.abs(window.nativeRect(anchor.element).top-top-anchor.offset-window.transcript.anchorTop+vp.scrollTop)));};
let width='360px';const ids=Array.from({length:1500},(_,index)=>index);
const draw=()=>render(html\`\${component(MessageScroller,{id:'transcript',label:'Conversation',style:'height:420px;width:'+width},
  repeat(ids,id=>id,id=>html\`<div data-row=\${id} style="min-height:36px;overflow-wrap:anywhere">\${'Message '+id+' '+'word '.repeat(id%9*6)}</div>\`))}\`,document.querySelector('#app'));
window.resize=value=>{width=value;draw();};
draw();window.ready=true;
`);
    await build({ root, configFile: false, logLevel: 'silent', plugins: [await tailwind()], build: { outDir: 'dist', emptyOutDir: true } });
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await fs.readFile(file)); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready && window.transcript);
    const viewport = page.locator('#transcript-viewport');
    await page.waitForFunction(() => { const vp = document.querySelector('#transcript-viewport'); return vp.scrollHeight - vp.clientHeight - vp.scrollTop < 1; });
    // Leave the bottom so the jump button is already shown and no re-render happens while scrolling.
    await viewport.evaluate(el => { el.addEventListener('scroll', () => window.stats.scrolls++); el.scrollTop = el.scrollHeight / 2; });
    await page.locator('.cs-message-scroller__jump').waitFor();
    await page.evaluate(() => window.settle());
    await page.evaluate(() => window.settle());

    await page.evaluate(() => window.resetStats());
    await viewport.evaluate(async el => {
      for (let step = 0; step < 40; step++) { el.scrollTop -= 90; await window.settle(); }
      for (let step = 0; step < 40; step++) { el.scrollTop += 90; await window.settle(); }
    });
    await viewport.hover();
    for (let step = 0; step < 15; step++) { await page.mouse.wheel(0, -150); await page.evaluate(() => window.settle()); }
    for (let step = 0; step < 15; step++) { await page.mouse.wheel(0, 150); await page.evaluate(() => window.settle()); }
    // A burst of input events before one frame is still one measurement pass.
    await viewport.evaluate(async el => { for (let event = 0; event < 8; event++) el.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true })); await window.settle(); });
    await page.evaluate(() => window.settle());
    const scrolling = await page.evaluate(() => window.snapshot());
    expect(scrolling.scrolls).toBeGreaterThan(80);
    expect(scrolling.reconciles).toBe(0);
    expect(scrolling.passes).toBeGreaterThan(80);
    expect(scrolling.maxPassesPerFrame).toBe(1);
    // Every row was read at most once: scrolling reads only rows not measured before.
    expect(scrolling.rowsRead).toBeGreaterThan(20);
    expect(scrolling.maxReadsPerRow).toBe(1);
    expect(await page.evaluate(() => window.anchorError())).toBeLessThan(1);

    // A resize changes row heights: the observers discard cached geometry.
    await page.evaluate(() => window.resetStats());
    await page.evaluate(() => window.resize('300px'));
    await page.evaluate(() => window.settle());
    await page.evaluate(() => window.settle());
    await viewport.evaluate(async el => { el.scrollTop -= 45; await window.settle(); });
    const resized = await page.evaluate(() => window.snapshot());
    expect(resized.reconciles).toBeGreaterThan(0);
    expect(resized.rowsRead).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.anchorError())).toBeLessThan(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
