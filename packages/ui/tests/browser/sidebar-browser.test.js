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
const installed = process.env.COSSACK_SIDEBAR_INSTALLED_ROOT;
const packageRoot = name => installed ? path.join(installed, 'node_modules/@cossackframework', name) : path.join(repository, 'packages', name);
const require = createRequire(installed ? path.join(installed, 'package.json') : new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves Sidebar navigation, disclosures, collapsed modes and native links', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-sidebar-'));
  let server,browser;
  const templateSource=`(p={})=>{const items=[{value:'home',label:'Home',href:'/home',linkProps:{'@click':p.capture}},{value:'projects',label:'Projects',href:'/projects',children:[{value:'one',label:'Project one',href:'/one',active:true},{value:'nested',label:'Nested',children:[{value:'deep',label:'Deep page',href:'/deep'}]}]},{value:'new',label:'New tab',href:'/new',linkProps:{target:'_blank'}},{value:'download',label:'Download',href:'/download.txt',linkProps:{download:'export.txt'}},{value:'external',label:'External',href:'https://example.test/away'},{value:'mail',label:'Email',href:'mailto:test@example.test'},{value:'prevent',label:'Prevented',href:'/prevent',linkProps:{'@click':p.cancel}}].filter(item=>!p.removeHome||item.value!=='home');return html\`<button id="before">Before</button>\${component(Sidebar,{id:'main-nav',label:'Main pages',title:'Application',items:p.reverse?[...items].reverse():items,navProps:{'data-nav':'main','@click':p.capture},collapsed:p.collapsed??false,dir:p.dir??'ltr',width:p.width??'260px',style:'min-height:0;height:500px;',onCollapsedChange:p.toggle,onNavigate:p.navigate,'data-root':'main','@click':p.capture,footer:html\`<button type="button" id="footer">Account<span id="account-details" class="group-[.is-collapsed]:hidden">Account details</span></button>\`})}<button id="opener" aria-controls="mobile-nav" aria-expanded=\${!(p.mobileHidden??true)} @click=\${p.openMobile}>Open mobile navigation</button>\${component(Sidebar,{id:'mobile-nav',label:'Mobile pages',items:[{value:'mobile-home',label:'Mobile home',href:'/home'}],collapsible:'offcanvas',restoreFocusTo:'opener',collapsed:p.mobileHidden??true,style:'min-height:0;height:200px;',onCollapsedChange:p.toggleMobile,onNavigate:p.navigate})}<button id="after">After</button>\`};`;
  try {
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['renderer','core','ui'])await fs.symlink(packageRoot(name),path.join(scope,name),'dir');
    const publicImports=path.join(root,'library.mjs');
    await fs.writeFile(publicImports,`export {html,renderToString,minifyHtml} from '@cossackframework/renderer/server';export {component} from '@cossackframework/renderer';export {Sidebar} from '@cossackframework/ui';`);
    const {html,renderToString,minifyHtml,component,Sidebar}=await import(pathToFileURL(publicImports).href);
    const template=new Function('html','component','Sidebar',`return (${templateSource.slice(0,-1)})`)(html,component,Sidebar);
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template(),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.mkdir(path.join(root,'public'));await fs.writeFile(path.join(root,'public/download.txt'),'fixture export');
    await fs.writeFile(path.join(root,'style.css'),`
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(packageRoot('ui'),'src/theme/base.css'))};
@import ${JSON.stringify(path.join(packageRoot('ui'),'src/theme/theme.css'))};
@source ${JSON.stringify(path.join(packageRoot('ui'),'src'))};
@source ${JSON.stringify(path.join(root,'main.js'))};
`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Sidebar} from '@cossackframework/ui';
const template=${templateSource}
const container=document.querySelector('#app'),initial=[...container.querySelectorAll('#main-nav,#main-nav-nav,#main-nav summary,#main-nav a')];let props={};window.visits=[];window.targets=[];window.toggles=[];
function current(){return {...props,capture:event=>window.targets.push(event.currentTarget.tagName+'#'+(event.currentTarget.id||event.currentTarget.getAttribute('href'))),cancel:event=>event.preventDefault(),navigate:(item,event)=>window.visits.push({value:item.value,tag:event.currentTarget.tagName}),toggle:value=>{window.toggles.push(value);if(props.acceptToggle!==false){props.collapsed=value;draw();}},openMobile:()=>{props.mobileHidden=false;draw();},toggleMobile:value=>{props.mobileHidden=value;draw();}};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
hydrate(template(current()),container);window.retained=initial.every(node=>node.isConnected&&container.contains(node));

`);
    const built = await build({ root, configFile: false, logLevel: 'silent', plugins:[tailwind()], build: { outDir: 'dist', emptyOutDir: true } });
    const chunks = (Array.isArray(built) ? built : [built]).flatMap(result => result.output).filter(chunk => chunk.type === 'chunk');
    const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
    if(installed)expect(modules.some(id=>id.includes(installed)&&id.includes('cossackframework')&&id.includes('ui'))).toBe(true);
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

    const noJS=await browser.newContext({javaScriptEnabled:false}),staticPage=await noJS.newPage();await staticPage.goto(url);
    await browserExpect(staticPage.getByRole('navigation',{name:'Main pages'})).toBeVisible();const staticSummary=staticPage.locator('[data-sidebar-value="projects"] > details > summary');
    await staticSummary.click();await browserExpect(staticPage.getByRole('link',{name:'Project one',exact:true})).toBeHidden();await staticSummary.click();await browserExpect(staticPage.getByRole('link',{name:'Project one',exact:true})).toBeVisible();
    await staticPage.getByRole('link',{name:'Home',exact:true}).click();await browserExpect(staticPage).toHaveURL(/\/home$/);await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    await browserExpect(page.locator('#account-details')).toBeVisible();
    const sidebarRoot=page.locator('#main-nav'),summary=page.locator('[data-sidebar-value="projects"] > details > summary'),details=summary.locator('..'),home=page.getByRole('link',{name:'Home',exact:true});
    const accessibility = await page.context().newCDPSession(page);
    const { root: domRoot } = await accessibility.send('DOM.getDocument');
    const { nodeId } = await accessibility.send('DOM.querySelector', { nodeId: domRoot.nodeId, selector: '[data-sidebar-value="projects"] > details > summary' });
    const { nodes: accessibleNodes } = await accessibility.send('Accessibility.getPartialAXTree', { nodeId });
    const disclosure = accessibleNodes.find(node => node.role?.value === 'DisclosureTriangle');
    expect(disclosure?.ignored).toBe(false);
    expect(disclosure?.name?.value).toBe('Projects');
    expect(disclosure?.properties?.find(property => property.name === 'expanded')?.value.value).toBe(true);
    await accessibility.detach();
    await browserExpect(sidebarRoot).toHaveAttribute('data-root','main');await browserExpect(page.locator('#main-nav-nav')).toHaveAttribute('data-nav','main');
    await browserExpect(page.getByRole('link',{name:'Project one',exact:true})).toHaveAttribute('aria-current','page');
    await summary.focus();await page.keyboard.press('Enter');expect(await details.evaluate(el=>el.open)).toBe(false);await page.evaluate(()=>window.update({width:'280px'}));expect(await details.evaluate(el=>el.open)).toBe(false);
    await page.keyboard.press('Space');expect(await details.evaluate(el=>el.open)).toBe(true);await page.getByRole('link',{name:'Project one',exact:true}).focus();await page.keyboard.press('Escape');await browserExpect(summary).toBeFocused();expect(await details.evaluate(el=>el.open)).toBe(false);
    await summary.click();await page.locator('[data-sidebar-value="nested"] > details > summary').click();await browserExpect(page.getByRole('link',{name:'Deep page'})).toBeVisible();
    await page.evaluate(()=>{window.savedSummary=document.querySelector('[data-sidebar-value="projects"] > details > summary');window.savedHome=document.querySelector('a[href="/home"]');});await home.focus();await page.evaluate(()=>window.update({reverse:true}));await browserExpect(home).toBeFocused();expect(await page.evaluate(()=>window.savedSummary===document.querySelector('[data-sidebar-value="projects"] > details > summary')&&window.savedHome===document.querySelector('a[href="/home"]'))).toBe(true);
    await sidebarRoot.getByRole('button',{name:'Collapse navigation',exact:true}).click();await browserExpect(sidebarRoot).toHaveClass(/is-collapsed/);await browserExpect(sidebarRoot.locator('.cs-sidebar__footer')).toHaveClass(/is-collapsed/);await browserExpect(page.locator('#account-details')).toBeHidden();await browserExpect.poll(()=>sidebarRoot.evaluate(el=>el.getBoundingClientRect().width)).toBe(72);
    await browserExpect(page.getByRole('link',{name:'Project one',exact:true})).toBeVisible();await browserExpect(page.getByRole('link',{name:'Deep page'})).toBeVisible();await home.focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.visits.at(-1))).toEqual({value:'home',tag:'A'});
    expect(await page.evaluate(()=>window.targets)).toEqual(expect.arrayContaining(['A#/home','NAV#main-nav-nav','ASIDE#main-nav']));
    await page.evaluate(()=>window.update({dir:'rtl'}));expect(await sidebarRoot.evaluate(el=>getComputedStyle(el).direction)).toBe('rtl');await browserExpect(summary).toHaveAccessibleName('Projects');
    await sidebarRoot.getByRole('button',{name:'Expand navigation',exact:true}).click();await browserExpect(page.locator('#account-details')).toBeVisible();await browserExpect(sidebarRoot.locator('.cs-sidebar__footer')).not.toHaveClass(/is-collapsed/);await page.evaluate(()=>window.update({acceptToggle:false}));await sidebarRoot.getByRole('button',{name:'Collapse navigation',exact:true}).click();await browserExpect(sidebarRoot).not.toHaveClass(/is-collapsed/);expect(await page.evaluate(()=>window.toggles.at(-1))).toBe(true);await page.evaluate(()=>window.update({acceptToggle:true}));
    const count=await page.evaluate(()=>window.visits.length);
    const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'New tab',exact:true}).click();const popup=await popupPromise;await browserExpect(popup).toHaveURL(/\/new$/);await popup.close();
    const modifiedPromise=page.context().waitForEvent('page');await home.click({modifiers:['Control']});const modified=await modifiedPromise;await browserExpect(modified).toHaveURL(/\/home$/);await modified.close();
    const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('export.txt');expect(await download.failure()).toBe(null);
    await page.getByRole('link',{name:'Prevented',exact:true}).click();expect(await page.evaluate(()=>window.visits.length)).toBe(count);
    for(const name of ['External','Email']) {
      const cancelled=await page.getByRole('link',{name,exact:true}).evaluate(el=>{let cancelled;el.addEventListener('click',event=>{cancelled=event.defaultPrevented;event.preventDefault();},{once:true});el.click();return cancelled;});expect(cancelled).toBe(false);
    }
    await page.evaluate(()=>{const base=document.createElement('base');base.target='_blank';document.head.append(base);});const basePopupPromise=page.waitForEvent('popup');await home.click();const basePopup=await basePopupPromise;await browserExpect(basePopup).toHaveURL(/\/home$/);await basePopup.close();await page.evaluate(()=>document.querySelector('base').remove());expect(await page.evaluate(()=>window.visits.length)).toBe(count);
    await home.focus();await page.evaluate(()=>window.update({removeHome:true}));await browserExpect(sidebarRoot.locator('.cs-sidebar__toggle')).toBeFocused();
    await page.locator('#opener').click();await browserExpect(page.getByRole('navigation',{name:'Mobile pages'})).toBeVisible();await page.getByRole('link',{name:'Mobile home',exact:true}).focus();await page.keyboard.press('Escape');await browserExpect(page.locator('#opener')).toBeFocused();await browserExpect(page.locator('#mobile-nav')).toBeHidden();await browserExpect(page.locator('#mobile-nav')).toHaveAttribute('inert','');
    await page.keyboard.press('Tab');await browserExpect(page.locator('#after')).toBeFocused();
    await page.locator('#opener').click();await page.locator('#mobile-nav .cs-sidebar__toggle').click();await browserExpect(page.locator('#opener')).toBeFocused();
    await page.emulateMedia({reducedMotion:'reduce'});expect(await sidebarRoot.evaluate(el=>getComputedStyle(el).transitionProperty)).toBe('none');
    await page.evaluate(()=>window.unmount());await page.evaluate(()=>window.fresh());await home.click();expect(await page.evaluate(()=>window.visits.length)).toBe(count+1);expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
