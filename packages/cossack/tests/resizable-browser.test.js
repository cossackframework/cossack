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
import { Resizable } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('preserves splitter geometry, keyboard and pointer ownership through hydration and cleanup', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-resizable-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<button id="before">Before</button>\${component(Resizable,{id:'split',label:'Navigation',primary:html\`<button type="button" id="primary-action" @click=\${p.action}>Primary action</button>\`,secondary:html\`<button type="button" id="secondary-action">Secondary action</button>\`,primaryProps:{'data-panel':'primary','@click':p.capture},secondaryProps:{'data-panel':'secondary','@click':p.capture},handleProps:{title:'Resize navigation','@focus':p.capture},defaultSize:p.defaultSize??30,minSize:p.minSize??10,size:p.size,step:p.step??1,orientation:p.orientation??'horizontal',disabled:p.disabled??false,dir:p.dir??'ltr',style:'height:200px;width:406px;',onSizeChange:p.change,'@click':p.capture})}\${component(Resizable,{id:'vertical',label:'Preview',orientation:'vertical',defaultSize:40,primary:'Top',secondary:'Bottom',style:'width:200px;height:406px;'})}\${component(Resizable,{id:'rtl',label:'RTL navigation',dir:'rtl',defaultSize:30,primary:'Right',secondary:'Left',style:'width:406px;height:160px;'})}\${component(Resizable,{id:'controlled',label:'Controlled',size:p.controlled??35,primary:'Controlled first',secondary:'Controlled second',style:'width:406px;height:120px;',onSizeChange:p.controlledChange})}<button id="after">After</button>\``;
  const template=new Function('html','component','Resizable',`return (${templateSource})`)(html,component,Resizable);
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
import {Resizable} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=[...container.querySelectorAll('#split,#split-primary,#split-handle,#split-secondary')];let props={};window.actions=0;window.proposals=[];window.controlledProposals=[];window.targets=[];
window.blurs=new Set();const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window);
window.addEventListener=(type,listener,options)=>{if(type==='blur')window.blurs.add(listener);add(type,listener,options);};
window.removeEventListener=(type,listener,options)=>{if(type==='blur')window.blurs.delete(listener);remove(type,listener,options);};
function current(){return {...props,capture:event=>window.targets.push(event.currentTarget.id),action:()=>window.actions++,change:value=>{window.proposals.push(value);if(props.throwChange)throw new Error('Expected resize callback failure');},controlledChange:value=>{window.controlledProposals.push(value);if(props.acceptControlled){props.controlled=value;draw();}}};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=patch=>{window.unmount();props=patch??{};draw();};
hydrate(template(current()),container);window.retained=initial.every(node=>node===container.querySelector('#'+node.id));

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

    const noJS=await browser.newContext({javaScriptEnabled:false}),staticPage=await noJS.newPage();
    await staticPage.goto(url);await browserExpect(staticPage.getByRole('separator',{name:'Navigation',exact:true})).toHaveAttribute('aria-valuenow','30');
    expect(await staticPage.locator('#split-primary').evaluate(el=>el.getBoundingClientRect().width)).toBe(120);await noJS.close();
    const page=await browser.newPage({hasTouch:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const handle=page.locator('#split-handle');
    const value=async(id='split')=>Number(await page.locator('#'+id+'-handle').getAttribute('aria-valuenow'));
    const expectValue=async(expected,id='split')=>browserExpect(page.locator('#'+id+'-handle')).toHaveAttribute('aria-valuenow',String(expected));
    const drag=async(id,dx,dy=0,release=true)=>{const box=await page.locator('#'+id+'-handle').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy);if(release)await page.mouse.up();};
    await browserExpect(handle).toHaveAttribute('aria-controls','split-primary');await browserExpect(handle).toHaveAttribute('title','Resize navigation');
    await page.locator('#primary-action').focus();await page.keyboard.press('Tab');await browserExpect(handle).toBeFocused();
    await page.keyboard.press('ArrowRight');await expectValue(31);await page.keyboard.press('Shift+ArrowRight');await expectValue(41);
    await page.keyboard.press('Home');await expectValue(10);await page.keyboard.press('End');await expectValue(90);
    await page.keyboard.press('Enter');await expectValue(10);await page.keyboard.press('Enter');await expectValue(90);
    await page.keyboard.press('ArrowDown');await expectValue(90);
    await page.evaluate(()=>window.fresh({defaultSize:0,minSize:0}));await expectValue(0);await handle.focus();await page.keyboard.press('Enter');await expectValue(50);await page.keyboard.press('Enter');await expectValue(0);
    await page.evaluate(()=>window.fresh());await page.evaluate(()=>window.update({defaultSize:70}));await expectValue(30);
    await drag('split',80);await expectValue(50);await page.evaluate(()=>window.update({defaultSize:20}));await expectValue(50);
    expect(await page.locator('#split-primary').evaluate(el=>el.getBoundingClientRect().width)).toBe(200);
    await handle.focus();await page.keyboard.press('ArrowRight');await expectValue(51);
    expect(await page.evaluate(()=>window.targets)).toContain('split-handle');
    await page.locator('#primary-action').click();expect(await page.evaluate(()=>window.actions)).toBe(1);expect(await page.evaluate(()=>window.targets)).toEqual(expect.arrayContaining(['split','split-primary']));await page.locator('#secondary-action').click();expect(await page.evaluate(()=>window.targets)).toContain('split-secondary');
    const vertical=page.locator('#vertical-handle');await vertical.focus();await page.keyboard.press('ArrowDown');await expectValue(41,'vertical');await browserExpect(vertical).toHaveAttribute('aria-orientation','horizontal');
    await drag('vertical',0,40);expect(await value('vertical')).toBeCloseTo(51,1);
    const rtl=page.locator('#rtl-handle');await rtl.focus();await page.keyboard.press('ArrowRight');await expectValue(29,'rtl');await drag('rtl',-40);expect(await value('rtl')).toBeCloseTo(39,1);
    const controlled=page.locator('#controlled-handle');await controlled.focus();await page.keyboard.press('ArrowRight');await expectValue(35,'controlled');expect(await page.evaluate(()=>window.controlledProposals.at(-1))).toBe(36);
    await page.evaluate(()=>window.update({acceptControlled:true}));await page.keyboard.press('ArrowRight');await expectValue(36,'controlled');await drag('controlled',40);expect(await value('controlled')).toBeCloseTo(46,1);
    await page.evaluate(()=>window.update({disabled:true}));await browserExpect(handle).toHaveAttribute('aria-disabled','true');await browserExpect(handle).toHaveAttribute('tabindex','-1');await drag('split',40);await expectValue(51);
    await page.evaluate(()=>window.update({disabled:false,minSize:50}));await expectValue(50);await browserExpect(handle).toHaveAttribute('aria-disabled','true');
    await page.evaluate(()=>window.update({minSize:0,size:50}));await page.locator('#primary-action').focus();await page.evaluate(()=>window.update({size:0}));await browserExpect(handle).toBeFocused();await browserExpect(page.locator('#split-primary')).toHaveAttribute('inert','');
    await handle.focus();await page.keyboard.press('Tab');await browserExpect(page.locator('#secondary-action')).toBeFocused();
    await page.evaluate(()=>window.update({size:100}));await browserExpect(handle).toBeFocused();await browserExpect(page.locator('#split-secondary')).toHaveAttribute('inert','');
    await page.evaluate(()=>{window.fresh();document.body.style.cursor='crosshair';document.body.style.userSelect='text';});const baseline=await page.evaluate(()=>window.blurs.size);
    await drag('split',1000);await expectValue(90);await drag('split',-1000);await expectValue(10);
    await page.evaluate(()=>window.fresh());
    await drag('split',0,0,false);const beforeForeign=await value();await handle.dispatchEvent('pointermove',{pointerId:9999,isPrimary:false,clientX:700,clientY:100,buttons:1,pointerType:'touch'});expect(await value()).toBe(beforeForeign);await page.mouse.up();
    await drag('split',10,0,false);await page.evaluate(()=>window.update({orientation:'vertical'}));expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline);await page.mouse.up();
    await page.evaluate(()=>window.fresh());await drag('split',10,0,false);await page.evaluate(()=>window.update({minSize:20}));expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline);await page.mouse.up();
    await page.evaluate(()=>window.fresh());await drag('split',10,0,false);await page.evaluate(()=>window.update({dir:'rtl'}));await page.mouse.move(180,100);expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline);await page.mouse.up();
    await page.evaluate(()=>window.fresh());
    await drag('split',20,0,false);expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline+1);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline);const blurValue=await value();await page.mouse.move(600,100);await page.mouse.up();expect(await value()).toBe(blurValue);
    await drag('split',20,0,false);await page.evaluate(()=>window.update({disabled:true}));expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline);await page.mouse.up();
    await page.evaluate(()=>window.fresh());await drag('split',20,0,false);await page.evaluate(()=>window.unmount());expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline);const callbacks=await page.evaluate(()=>window.proposals.length);await page.mouse.move(650,100);await page.mouse.up();expect(await page.evaluate(()=>window.proposals.length)).toBe(callbacks);
    await page.evaluate(()=>window.fresh());await page.evaluate(()=>window.update({throwChange:true}));await drag('split',20,0,false);expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline);await page.mouse.up();expect(errors).toEqual(['Expected resize callback failure']);errors.length=0;
    await page.evaluate(()=>window.fresh());await handle.scrollIntoViewIfNeeded();
    const cdp=await page.context().newCDPSession(page),box=await handle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:7}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+40,y,id:7}]});expect(await value()).toBeCloseTo(40,1);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline);await cdp.detach();
    await page.emulateMedia({reducedMotion:'reduce'});expect(await handle.evaluate(el=>getComputedStyle(el).transitionProperty)).toBe('none');
    await page.evaluate(()=>window.unmount());await page.evaluate(()=>window.fresh());await expectValue(30);expect(await page.evaluate(()=>window.blurs.size)).toBe(baseline);expect(await page.evaluate(()=>({cursor:document.body.style.cursor,select:document.body.style.userSelect}))).toEqual({cursor:'crosshair',select:'text'});expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
