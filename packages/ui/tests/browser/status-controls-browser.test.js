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
import { Alert, Progress, Spinner } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

it('preserves named status semantics, SVG callbacks and focus through hydration and updates', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-status-'));
  let server,browser;
  const templateSource=`(p={})=>html\`<input id="outside"><div style="width:320px">\${component(Alert,{id:'notice',announcement:p.announcement??'polite',title:'Upload',icon:null,'@click':p.capture},p.message??'Ready')}\${component(Progress,{id:'progress',label:'Upload',value:p.value,max:p.max??80,valueText:p.valueText,'@click':p.capture})}\${component(Spinner,{id:'spinner',label:p.label,size:p.size??24,stroke:3,'@click':p.capture})}</div><button id="after" type="button" @click=\${p.action}>Continue</button>\``;
  const template=new Function('html','component','Alert','Progress','Spinner',`return (${templateSource})`)(html,component,Alert,Progress,Spinner);
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
import {Alert,Progress,Spinner} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#progress');let props={};window.actions=0;window.targets=[];
function current(){return {...props,capture:event=>window.targets.push(event.currentTarget.tagName+'#'+event.currentTarget.id),action:()=>window.actions++};}
function draw(){render(template(current()),container);}
window.update=patch=>{props={...props,...patch};draw();};window.unmount=()=>render(html\`<p>Removed</p>\`,container);window.fresh=()=>{window.unmount();props={};draw();};
hydrate(template(current()),container);window.retained=initial===container.querySelector('#progress');
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

    const noJS = await browser.newContext({javaScriptEnabled:false});
    const staticPage = await noJS.newPage();
    await staticPage.goto(url);
    await browserExpect(staticPage.getByRole('progressbar', {name:'Upload'})).not.toHaveAttribute('aria-valuenow');
    expect((await staticPage.locator('#progress').boundingBox()).height).toBeGreaterThan(0);
    await browserExpect(staticPage.locator('#spinner')).toHaveAttribute('aria-hidden','true');
    await noJS.close();

    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.retained !== undefined);
    expect(await page.evaluate(() => window.retained)).toBe(true);
    const progress = page.getByRole('progressbar', {name:'Upload'}), spinner = page.locator('#spinner');
    const outside = page.locator('#outside'), after = page.locator('#after'), notice = page.locator('#notice');
    await browserExpect(notice).toHaveAttribute('role','status');
    await browserExpect(progress).not.toHaveAttribute('aria-valuenow');
    await browserExpect(progress).toHaveAttribute('data-state','indeterminate');
    const bar = progress.locator('.cs-progress__bar');
    expect(await bar.evaluate(el => getComputedStyle(el,'::after').animationName)).toBe('cs-shimmer');
    expect(await spinner.evaluate(el => getComputedStyle(el).animationName)).toBe('spin');
    expect(await spinner.evaluate(el => el.namespaceURI)).toBe('http://www.w3.org/2000/svg');
    expect(await spinner.evaluate(el => getComputedStyle(el).width)).toBe('24px');
    await outside.focus();
    await page.keyboard.press('Tab');
    await browserExpect(after).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.actions)).toBe(1);
    await page.evaluate(() => window.update({value:20,valueText:'2 of 8 files',label:'Uploading files',message:'Sending files'}));
    await browserExpect(after).toBeFocused();
    await browserExpect(progress).toHaveAttribute('aria-valuenow','20');
    await browserExpect(progress).toHaveAttribute('aria-valuetext','2 of 8 files');
    await browserExpect(progress).toHaveAttribute('data-state','determinate');
    await browserExpect.poll(() => bar.evaluate(el => el.getBoundingClientRect().width)).toBe(80);
    expect(await bar.evaluate(el => getComputedStyle(el,'::after').animationName)).toBe('none');
    await browserExpect(spinner).toHaveAttribute('role','status');
    await browserExpect(spinner).not.toHaveAttribute('aria-hidden');
    await browserExpect(spinner).toHaveAccessibleName('Uploading files');
    await browserExpect(spinner.locator('title')).toHaveText('Uploading files');
    expect(await spinner.locator('title').evaluate(el => el.namespaceURI)).toBe('http://www.w3.org/2000/svg');
    await browserExpect(notice).toContainText('Sending files');
    await page.evaluate(() => { window.targets=[]; document.querySelector('#spinner circle').dispatchEvent(new MouseEvent('click',{bubbles:true})); });
    await notice.click(); await progress.click();
    expect(await page.evaluate(() => window.targets)).toEqual(expect.arrayContaining(['svg#spinner','DIV#notice','DIV#progress']));
    await after.focus();
    await page.evaluate(() => window.update({announcement:'assertive',value:160,max:80,size:32}));
    await browserExpect(notice).toHaveAttribute('role','alert');
    await browserExpect(progress).toHaveAttribute('aria-valuenow','80');
    await browserExpect(after).toBeFocused();
    expect(await spinner.evaluate(el => getComputedStyle(el).width)).toBe('32px');
    await page.evaluate(() => window.update({announcement:'off',value:null,valueText:undefined,label:undefined}));
    await browserExpect(notice).not.toHaveAttribute('role');
    await browserExpect(progress).not.toHaveAttribute('aria-valuenow');
    await browserExpect(progress).not.toHaveAttribute('aria-valuetext');
    await browserExpect(spinner).toHaveAttribute('aria-hidden','true');
    await browserExpect(spinner).not.toHaveAttribute('role');
    await browserExpect(spinner.locator('title')).toHaveText('');
    await page.emulateMedia({reducedMotion:'reduce'});
    expect(await spinner.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    expect(await bar.evaluate(el => getComputedStyle(el,'::after').animationName)).toBe('none');
    expect(await bar.evaluate(el => getComputedStyle(el).transitionProperty)).toBe('none');
    await page.evaluate(() => window.unmount());
    expect(await page.getByRole('progressbar').count()).toBe(0);
    await page.evaluate(() => window.fresh());
    await after.click();
    expect(await page.evaluate(() => window.actions)).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
