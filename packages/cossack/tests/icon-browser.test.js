import { it, expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { html, renderToString } from '../../renderer/dist/server.js';
import { component } from '../../renderer/dist/index.js';
import { Icon } from '../../ui/dist/index.js';
import { ArrowRightIcon } from '@cossackframework/solar-icons/arrow-right';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('renders SVG artwork with native events, safe attributes and retained hydration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-icon-'));
  let server, browser;
  const source = `(p={})=>html\`<form @submit=\${event=>event.preventDefault()}><button type="button" id="action" @click=\${p.action}>Continue</button>\${component(Icon,{entry:ArrowRightIcon,id:'icon',variant:p.variant??'line',label:p.label??'Direction',style:p.style??'color: rgb(255, 0, 0)',class:p.class??'quoted" onload="window.injected=true','data-note':p.note,'@click':p.click})}</form>\``;
  const template = new Function('html','component','Icon','ArrowRightIcon',`return ${source}`)(html,component,Icon,ArrowRightIcon);
  try {
    const scope = path.join(root,'node_modules','@cossackframework'); await fs.mkdir(scope,{recursive:true});
    for (const name of ['renderer','core','ui']) await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.symlink(path.join(repository,'node_modules/@cossackframework/solar-icons'),path.join(scope,'solar-icons'),'dir');
    await fs.writeFile(path.join(root,'index.html'),`<html><body><main id="app">${renderToString(template(),{hydrate:true})}</main><div id="fresh"></div><div id="raw"></div><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'main.js'),`
import {html,render,hydrate,component,unsafeHTML} from '@cossackframework/renderer';
import {Icon} from '@cossackframework/ui';
import {ArrowRightIcon} from '@cossackframework/solar-icons/arrow-right';
const template=${source};let props={};window.clicks=[];window.actions=0;
const app=document.querySelector('#app'),old=app.querySelector('svg'),oldPath=app.querySelector('path');
const current=()=>({...props,click:event=>window.clicks.push(event.currentTarget instanceof SVGSVGElement),action:()=>window.actions++});
hydrate(template(current()),app);window.retained=old===app.querySelector('svg')&&oldPath===app.querySelector('path');
window.update=patch=>{props={...props,...patch};render(template(current()),app);};
render(component(Icon,{entry:ArrowRightIcon,label:'Fresh',id:'fresh-icon'}),document.querySelector('#fresh'));
render(html\`<svg><g>\${unsafeHTML('<path d="M0 0h10v10z"/><script>window.rawExecuted=true</script>')}</g><foreignObject>\${unsafeHTML('<div id="inside-html">HTML</div>')}</foreignObject></svg><section>\${unsafeHTML('<script>window.rawExecuted=true</script>')}</section>\`,document.querySelector('#raw'));
window.ready=true;
`);
    const built = await build({root,configFile:false,logLevel:'silent',build:{outDir:'dist',emptyOutDir:true}});
    const modules=(Array.isArray(built)?built:[built]).flatMap(result=>result.output).filter(item=>item.type==='chunk').flatMap(chunk=>Object.keys(chunk.modules));
    expect(modules.some(id=>id.includes('/parse5/')||id.endsWith('/ssr-form-values.js'))).toBe(false);
    server=createServer(async(request,response)=>{
      const pathname=new URL(request.url,'http://localhost').pathname;
      const file=path.resolve(root,'dist','.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(path.join(root,'dist')+path.sep)){response.writeHead(404);response.end();return;}
      try{response.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');response.end(await fs.readFile(file));}
      catch{response.writeHead(404);response.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true});
    const url=`http://127.0.0.1:${server.address().port}`;
    const staticContext=await browser.newContext({javaScriptEnabled:false});
    const staticPage=await staticContext.newPage();await staticPage.goto(url);
    await browserExpect(staticPage.getByRole('img',{name:'Direction'})).toBeVisible();
    expect(await staticPage.locator('#icon').getAttribute('onload')).toBeNull();
    await browserExpect(staticPage.locator('#icon')).toHaveAttribute('class','cs-icon quoted" onload="window.injected=true');
    await staticContext.close();
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
    expect(await page.evaluate(()=>window.retained)).toBe(true);
    expect(await page.evaluate(()=>window.injected)).toBeUndefined();
    await browserExpect(page.getByRole('img',{name:'Direction'})).toBeVisible();
    expect(await page.evaluate(()=>[...document.querySelectorAll('#icon path,#fresh-icon path,#raw path')].every(node=>node instanceof SVGPathElement&&node.getBBox().width>0))).toBe(true);
    expect(await page.evaluate(()=>[...document.querySelectorAll('title')].every(node=>node.namespaceURI==='http://www.w3.org/2000/svg'))).toBe(true);
    expect(await page.locator('#inside-html').evaluate(node=>node.namespaceURI)).toBe('http://www.w3.org/1999/xhtml');
    expect(await page.evaluate(()=>window.rawExecuted)).toBeUndefined();
    await page.locator('#icon').click();expect(await page.evaluate(()=>window.clicks)).toEqual([true]);
    await page.locator('#action').focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.actions)).toBe(1);
    const payload='x" onload="window.injected=true <script>&copy;';
    await page.evaluate(payload=>window.update({variant:'bold',label:payload,class:payload,note:payload,style:'color: rgb(0, 0, 255)'}),payload);
    await browserExpect(page.locator('#icon')).toHaveAttribute('aria-label',payload);
    await browserExpect(page.locator('#icon')).toHaveAttribute('data-note',payload);
    expect(await page.locator('#icon').getAttribute('onload')).toBeNull();
    expect(await page.evaluate(()=>window.injected)).toBeUndefined();
    expect(await page.locator('#icon path').first().evaluate(node=>node instanceof SVGPathElement&&node.getBBox().width>0)).toBe(true);
    expect(await page.locator('#icon').evaluate(node=>getComputedStyle(node).color)).toBe('rgb(0, 0, 255)');
    await page.evaluate(()=>window.update({label:''}));await browserExpect(page.locator('#icon')).toHaveAttribute('aria-hidden','true');
    expect(await page.locator('#icon title').count()).toBe(0);expect(errors).toEqual([]);
  } finally {
    await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});
  }
},120000);
