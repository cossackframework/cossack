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
import { Skeleton, Card, CardHeader, CardBody, CardFooter, Badge, Kbd } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves decorative loading shapes, native card slots and descriptive text through hydration', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-display-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<input id="outside"><div id="loading" aria-busy="true" style="width:320px;font-size:16px">\${component(Skeleton,{id:'line',width:p.width,height:p.height,style:'opacity:0.75','data-shape':'line','@click':p.capture})}\${component(Skeleton,{id:'circle',circle:true,size:p.size??40,'@click':p.capture})}</div><div style="width:320px">\${component(Card,{id:'card',padding:p.padding??'none',hoverable:p.hoverable??true,'@click':p.capture},html\`\${component(CardHeader,{id:'header','@click':p.capture},html\`<h2>Account</h2>\`)}\${component(CardBody,{id:'body','@click':p.capture},html\`Content \${component(Badge,{id:'badge',variant:p.variant??'success','@click':p.capture},'Saved')} \${component(Kbd,{id:'key',title:'Control key','@click':p.capture},'Ctrl')}\`)}\${component(CardFooter,{id:'footer','@click':p.capture},html\`<button id="action" type="button" @click=\${p.action}>Save</button><a id="link" href="#destination">Details</a>\`)}\`)}</div>\${component(Card,{id:'plain'},'Plain content')}<button id="after">After</button><div id="destination">Destination</div>\``;
  const template=new Function('html','component','Skeleton','Card','CardHeader','CardBody','CardFooter','Badge','Kbd',`return (${templateSource})`)(html,component,Skeleton,Card,CardHeader,CardBody,CardFooter,Badge,Kbd);
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
import {Skeleton,Card,CardHeader,CardBody,CardFooter,Badge,Kbd} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#card');let props={};window.actions=0;window.targets=[];
function current(){return {...props,capture:event=>window.targets.push(event.currentTarget.tagName+'#'+event.currentTarget.id),action:()=>window.actions++};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#card');
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

    const noJS=await browser.newContext({javaScriptEnabled:false}),staticPage=await noJS.newPage();await staticPage.goto(url);expect((await staticPage.locator('#line').boundingBox()).height).toBeCloseTo(16,0);expect((await staticPage.locator('#circle').boundingBox()).width).toBeCloseTo(40,0);await staticPage.getByRole('link',{name:'Details'}).click();await browserExpect(staticPage).toHaveURL(/#destination$/);await noJS.close();
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const line=page.locator('#line'),circle=page.locator('#circle'),card=page.locator('#card'),action=page.locator('#action'),outside=page.locator('#outside');
    await browserExpect(line).toHaveAttribute('aria-hidden','true');await browserExpect(circle).toHaveAttribute('aria-hidden','true');await browserExpect(line).toHaveAttribute('data-shape','line');let box=await line.boundingBox();expect(box.width).toBeCloseTo(320,0);expect(box.height).toBeCloseTo(16,0);box=await circle.boundingBox();expect(box.width).toBeCloseTo(40,0);expect(box.height).toBeCloseTo(40,0);expect(await line.evaluate(el=>getComputedStyle(el).animationName)).toBe('pulse');
    await outside.focus();await page.keyboard.press('Tab');await browserExpect(action).toBeFocused();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.actions)).toBe(1);await page.keyboard.press('Tab');await browserExpect(page.locator('#link')).toBeFocused();await page.keyboard.press('Enter');expect(await page.evaluate(()=>location.hash)).toBe('#destination');
    expect(await card.evaluate(el=>getComputedStyle(el).paddingTop)).toBe('0px');expect(await page.locator('#plain').evaluate(el=>getComputedStyle(el).paddingTop)).toBe('24px');expect(await page.locator('#header').evaluate(el=>getComputedStyle(el).paddingLeft)).toBe('24px');expect(await page.locator('#body').evaluate(el=>getComputedStyle(el).paddingTop)).toBe('0px');expect(await page.locator('#footer').evaluate(el=>getComputedStyle(el).paddingLeft)).toBe('24px');
    await card.hover();expect(await card.evaluate(el=>getComputedStyle(el).cursor)).toBe('auto');await browserExpect.poll(()=>card.evaluate(el=>getComputedStyle(el).translate)).toBe('0px -2px');
    await page.evaluate(()=>window.targets=[]);for(const id of ['line','circle','header','body','footer','badge','key'])await page.locator('#'+id).evaluate(el=>el.click());expect(await page.evaluate(()=>window.targets)).toEqual(expect.arrayContaining(['DIV#line','DIV#circle','DIV#header','DIV#body','DIV#footer','DIV#card','SPAN#badge','KBD#key']));
    await page.evaluate(()=>window.update({width:'50%',height:12,size:'2rem',padding:'sm',variant:'outline'}));box=await line.boundingBox();expect(box.width).toBeCloseTo(160,0);expect(box.height).toBeCloseTo(12,0);box=await circle.boundingBox();expect(box.width).toBeCloseTo(32,0);expect(box.height).toBeCloseTo(32,0);expect(await card.evaluate(el=>getComputedStyle(el).paddingTop)).toBe('16px');await browserExpect(page.locator('#badge')).toHaveClass(/cs-badge--outline/);
    await page.emulateMedia({reducedMotion:'reduce'});await card.hover();expect(await line.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');expect(await circle.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');await browserExpect.poll(()=>card.evaluate(el=>getComputedStyle(el).translate)).toBe('0px');expect(await card.evaluate(el=>getComputedStyle(el).transitionProperty)).toBe('none');await browserExpect(page.locator('#key')).toHaveText('Ctrl');expect(await page.getByRole('button').count()).toBe(2);
    await page.evaluate(()=>{window.fresh();window.unmount();});expect(await page.locator('.cs-skeleton').count()).toBe(0);await page.evaluate(()=>window.fresh());await action.click();expect(await page.evaluate(()=>window.actions)).toBe(2);expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
