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
import { Popover } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('hydrates stable native popovers and preserves keyboard, geometry and cleanup behavior', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-popover-'));
  let server,browser;
  const templateSource=`(props={})=>html\`<form><fieldset><div id="scroller" style="height:240px;overflow:auto"><div style="height:800px;padding-top:100px;padding-left:100px">\${component(Popover,{id:'details',trigger:'Details',side:'bottom',align:'start',...props},html\`<h2 id="heading">Popover details</h2><input aria-label="Value"><button type="button" id="inside">Inside</button>\`)}</div></div></fieldset><button type="button" id="after">After</button></form>\``;
  const template=new Function('html','component','Popover',`return (${templateSource})`)(html,component,Popover);
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
import {html,hydrate,render,component,preventDefault} from '@cossackframework/renderer';
import {Popover as BasePopover} from '@cossackframework/ui';
class Popover extends BasePopover { constructor(){super();window.instance=this;} }
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#details'),initialPanel=container.querySelector('#details-content');
let props={};window.events=[];window.veto=false;window.vetoOpen=false;
const callbacks={'@click':event=>{window.events.push(['click',event.currentTarget.id]);if(window.veto)event.preventDefault();}};
const panelCallbacks={'@toggle':event=>window.events.push(['toggle',event.currentTarget.id,event.newState]),'@beforetoggle':event=>{window.events.push(['before',event.currentTarget.id,event.newState]);if(window.vetoOpen&&event.newState==='open')event.preventDefault();}};
function current(){return {...props,...callbacks,'@click':window.directiveVeto?preventDefault(callbacks['@click']):callbacks['@click'],contentProps:{'aria-labelledby':'heading',role:'dialog',...props.contentProps,...panelCallbacks}};}
function draw(){render(template(current()),container);}
window.update=next=>{props={...props,...next};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#details')&&initialPanel===container.querySelector('#details-content');
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=()=>{window.unmount();props={};draw();};
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






    const noJS=await browser.newContext({javaScriptEnabled:false});const staticPage=await noJS.newPage();await staticPage.goto(url);
    await browserExpect(staticPage.locator('#details-content')).not.toBeVisible();await staticPage.locator('#details').click();await browserExpect(staticPage.locator('#details-content')).toBeVisible();await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);
    expect(await page.evaluate(()=>window.retained)).toBe(true);
    const button=page.locator('#details'),panel=page.locator('#details-content');
    await button.focus();await page.keyboard.press('Enter');await browserExpect(panel).toBeVisible();await browserExpect(button).toBeFocused();
    // Native toggle notifications are queued and may coalesce. Observe the
    // opening callback before testing a separate closing notification.
    await browserExpect.poll(()=>page.evaluate(()=>window.events.filter(e=>e[0]==='toggle'))).toEqual([['toggle','details-content','open']]);
    const accessibility=await page.context().newCDPSession(page);
    const {root:documentNode}=await accessibility.send('DOM.getDocument');
    const {nodeId}=await accessibility.send('DOM.querySelector',{nodeId:documentNode.nodeId,selector:'#details'});
    const {nodes}=await accessibility.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});
    expect(nodes[0].properties.find(property=>property.name==='expanded')?.value.value).toBe(true);
    await accessibility.detach();
    await page.keyboard.press('Tab');await browserExpect(page.getByLabel('Value')).toBeFocused();
    await page.keyboard.press('Escape');await browserExpect(panel).not.toBeVisible();await browserExpect(button).toBeFocused();
    await browserExpect.poll(()=>page.evaluate(()=>window.events.filter(e=>e[0]==='toggle'))).toEqual([['toggle','details-content','open'],['toggle','details-content','closed']]);
    await page.evaluate(()=>{window.veto=true;});await button.click();await browserExpect(panel).not.toBeVisible();
    await page.evaluate(()=>{window.veto=false;window.directiveVeto=true;window.update({});});await button.click();await browserExpect(panel).not.toBeVisible();
    await page.evaluate(()=>{window.directiveVeto=false;window.update({});window.vetoOpen=true;});await button.click();await browserExpect(panel).not.toBeVisible();
    await page.evaluate(()=>{window.vetoOpen=false;});await button.click();await browserExpect(panel).toBeVisible();
    await browserExpect.poll(()=>page.evaluate(()=>Math.abs(document.querySelector('#details-content').getBoundingClientRect().left-document.querySelector('#details').getBoundingClientRect().left))).toBeLessThan(2);
    await page.locator('#scroller').evaluate(el=>{el.scrollTop=40;});
    await browserExpect.poll(()=>page.evaluate(()=>Math.abs(document.querySelector('#details-content').getBoundingClientRect().top-document.querySelector('#details').getBoundingClientRect().bottom-8))).toBeLessThan(2);
    await page.evaluate(()=>window.update({dir:'rtl',align:'start'}));
    // Put the trigger far enough from the left boundary to observe RTL alignment.
    await page.locator('#scroller > div').evaluate(el=>{el.style.paddingLeft='500px';});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    await browserExpect.poll(()=>page.evaluate(()=>Math.abs(document.querySelector('#details-content').getBoundingClientRect().right-document.querySelector('#details').getBoundingClientRect().right))).toBeLessThan(2);
    await page.evaluate(()=>window.update({side:'top',contentProps:{style:'width:200px;'}}));
    await panel.evaluate(el=>{const child=document.createElement('div');child.id='growth';child.style.height='400px';el.append(child);});
    await browserExpect(panel).toHaveAttribute('data-side','bottom');
    await page.setViewportSize({width:640,height:480});
    await browserExpect.poll(()=>panel.evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(633);
    await browserExpect.poll(()=>panel.evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(473);
    await page.setViewportSize({width:1280,height:720});await page.locator('#growth').evaluate(el=>el.remove());
    await page.evaluate(()=>window.update({contentProps:{style:'width:2000px;height:2000px;'}}));
    await browserExpect.poll(()=>panel.evaluate(el=>el.getBoundingClientRect().width)).toBeLessThan(1280);
    const bounds=await panel.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(7);expect(bounds.y).toBeGreaterThanOrEqual(7);expect(bounds.x+bounds.width).toBeLessThanOrEqual(1273);expect(bounds.y+bounds.height).toBeLessThanOrEqual(713);
    await page.evaluate(()=>window.instance.hide());await browserExpect(panel).not.toBeVisible();
    await page.evaluate(()=>window.update({contentProps:{},dir:'ltr'}));await page.evaluate(()=>window.instance.show());await browserExpect(panel).toBeVisible();
    await page.locator('#after').click();await browserExpect(panel).not.toBeVisible();await browserExpect(page.locator('#after')).toBeFocused();
    await page.evaluate(()=>window.instance.toggle());await browserExpect(panel).toBeVisible();
    await page.evaluate(()=>window.update({disabled:true}));await browserExpect(button).toBeDisabled();await browserExpect(panel).not.toBeVisible();
    await page.evaluate(()=>window.instance.show());await browserExpect(panel).not.toBeVisible();
    await page.evaluate(()=>window.update({disabled:false}));await button.click();await browserExpect(panel).toBeVisible();
    await page.locator('fieldset').evaluate(el=>{el.disabled=true;});await browserExpect(panel).not.toBeVisible();
    await page.locator('fieldset').evaluate(el=>{el.disabled=false;});await page.evaluate(()=>window.update({id:'renamed'}));
    await browserExpect(page.locator('#renamed')).toHaveAttribute('popovertarget','renamed-content');await page.locator('#renamed').click();await browserExpect(page.locator('#renamed-content')).toBeVisible();
    await page.evaluate(()=>window.unmount());await page.evaluate(()=>{window.instance.show();window.instance.hide();window.instance.toggle();window.dispatchEvent(new Event('resize'));document.dispatchEvent(new Event('scroll'));});
    await page.evaluate(()=>window.fresh());await button.click();await browserExpect(panel).toBeVisible();await page.keyboard.press('Escape');await browserExpect(panel).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
