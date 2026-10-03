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
import { Calendar, DatePicker } from '../../ui/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../framework/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('hydrates date values and navigates bounded calendars with keyboard and native forms', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-dates-'));
  let server,browser;
  const templateSource=`(cal={},picker={})=>html\`<section>\${component(Calendar,{id:'calendar',value:'2024-02-29',today:'2024-02-20',min:'2024-02-01',max:'2025-03-31',...cal})}</section><form><label for="due">Due date</label><fieldset>\${component(DatePicker,{id:'due',name:'due',defaultValue:'2024-02-29',today:'2024-02-20',min:'2024-02-10',max:'2024-03-05',required:true,...picker})}</fieldset><button id="after" type="button">After</button></form>\``;
  const template=new Function('html','component','Calendar','DatePicker',`return (${templateSource})`)(html,component,Calendar,DatePicker);
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
import {Calendar,DatePicker} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app'),initial=container.querySelector('#due'),day=container.querySelector('[data-date="2024-02-29"]');
let cal={},picker={};window.dates=[];window.picks=[];window.native=[];window.calAccept=true;
const callbacks={onChange:iso=>{window.picks.push(iso);if(window.accept){picker.value=iso;draw();}},'@input':event=>window.native.push(event.currentTarget.id)};
const calendarCallbacks={onChange:iso=>{window.dates.push(iso);if(window.calAccept){cal.value=iso;draw();}}};
function draw(){render(template({...cal,...calendarCallbacks},{...picker,...callbacks}),container);}
window.update=(nextCal,nextPicker)=>{cal={...cal,...nextCal};picker={...picker,...nextPicker};draw();};
hydrate(template(calendarCallbacks,callbacks),container);window.retained=initial===container.querySelector('#due')&&day===container.querySelector('[data-date="2024-02-29"]');
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
window.fresh=()=>{window.unmount();cal={};picker={};draw();};
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




    const noJS=await browser.newContext({javaScriptEnabled:false});const initial=await noJS.newPage();await initial.goto(url);
    await browserExpect(initial.getByLabel('Due date',{exact:true})).toHaveValue('2024-02-29');
    await browserExpect(initial.locator('#calendar-month')).toHaveText('February 2024');
    await browserExpect(initial.locator('#calendar [data-date][tabindex="0"]')).toHaveCount(1);await noJS.close();
    const page=await browser.newPage({timezoneId:'America/Los_Angeles'}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
    await page.waitForFunction(()=>window.retained!==undefined);expect(await page.evaluate(()=>window.retained)).toBe(true);
    const calendar=page.locator('#calendar'),date=page.getByLabel('Due date',{exact:true}),trigger=page.locator('.cs-datepicker__trigger'),dialog=page.getByRole('dialog',{name:'Choose date'});
    const day=iso=>calendar.locator(`[data-date="${iso}"]`);
    await day('2024-02-29').focus();await page.keyboard.press('ArrowRight');
    await browserExpect(day('2024-03-01')).toBeFocused();await browserExpect(calendar.locator('[data-date][tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('PageUp');await browserExpect(day('2024-02-01')).toBeFocused();
    await page.keyboard.press('ArrowLeft');await browserExpect(day('2024-02-01')).toBeFocused();
    await day('2024-02-29').focus();await page.keyboard.press('Shift+PageDown');await browserExpect(day('2025-02-28')).toBeFocused();
    await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.dates)).toEqual(['2025-02-28']);
    await page.evaluate(()=>window.update({value:'2024-03-10',weekStartsOn:1},{}));await browserExpect(day('2024-03-10')).toBeFocused();
    await page.keyboard.press('Home');await browserExpect(day('2024-03-04')).toBeFocused();await page.keyboard.press('End');await browserExpect(day('2024-03-10')).toBeFocused();
    await page.evaluate(()=>window.update({value:'2024-02-01'},{}));await browserExpect(day('2024-02-01')).toBeFocused();
    await page.evaluate(()=>window.update({value:'2024-03-01'},{}));await browserExpect(day('2024-03-01')).toBeFocused();
    await page.evaluate(()=>window.update({value:'2024-03-10'},{}));await browserExpect(day('2024-03-10')).toBeFocused();
    await page.evaluate(()=>{window.calAccept=false;});await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await browserExpect(calendar.locator('[aria-selected="true"] button')).toHaveAttribute('data-date','2024-03-10');
    await page.evaluate(()=>window.update({readonly:true},{}));await day('2024-03-12').click();
    await browserExpect(calendar.locator('[aria-selected="true"] button')).toHaveAttribute('data-date','2024-03-10');
    await trigger.click();await browserExpect(dialog).toBeVisible();await browserExpect(dialog.locator('[data-date="2024-02-29"]')).toBeFocused();
    await browserExpect(dialog.locator('[data-date="2024-02-09"]')).toBeDisabled();
    await page.keyboard.press('ArrowRight');
    await browserExpect(dialog.locator('[data-date="2024-03-01"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await browserExpect(date).toHaveValue('2024-03-01');await browserExpect(trigger).toBeFocused();await browserExpect(dialog).not.toBeVisible();
    expect(await page.evaluate(()=>new FormData(document.querySelector('form')).get('due'))).toBe('2024-03-01');
    // Choosing the current date still closes the panel, without a duplicate change.
    const before=await page.evaluate(()=>window.picks.length);await trigger.click();await page.keyboard.press('Enter');
    await browserExpect(dialog).not.toBeVisible();expect(await page.evaluate(()=>window.picks.length)).toBe(before);
    await trigger.click();await page.keyboard.press('Escape');await browserExpect(trigger).toBeFocused();await browserExpect(dialog).not.toBeVisible();
    await trigger.click();
    await dialog.locator('[data-date="2024-03-01"]').evaluate(el=>{
      for(const key of ['ArrowRight','ArrowRight','Enter'])el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
    });
    await browserExpect(date).toHaveValue('2024-03-03');await browserExpect(trigger).toBeFocused();
    await date.fill('2024-02-01');expect(await date.evaluate(el=>el.validity.rangeUnderflow)).toBe(true);
    await page.evaluate(()=>window.update({}, {value:'2024-02-20'}));await browserExpect(date).toHaveValue('2024-02-20');
    await date.fill('2024-03-02');await browserExpect(date).toHaveValue('2024-02-20');
    await page.evaluate(()=>{window.accept=true;});await date.fill('2024-03-02');await browserExpect(date).toHaveValue('2024-03-02');
    await page.evaluate(()=>document.querySelector('form').reset());await browserExpect(date).toHaveValue('2024-03-02');
    await page.evaluate(()=>{window.accept=false;window.update({}, {value:undefined});document.querySelector('form').reset();});await browserExpect(date).toHaveValue('2024-02-29');
    await date.fill('2024-03-04');await page.evaluate(()=>{const form=document.querySelector('form');form.addEventListener('reset',event=>event.preventDefault(),{once:true});form.reset();});await browserExpect(date).toHaveValue('2024-03-04');
    await trigger.click();await browserExpect(dialog).toBeVisible();await dialog.locator('[data-date="2024-03-04"]').press('Tab');await browserExpect(page.locator('#after')).toBeFocused();await browserExpect(dialog).not.toBeVisible();
    await date.fill('');expect(await date.evaluate(el=>el.checkValidity())).toBe(false);
    await page.evaluate(()=>window.update({}, {readonly:true}));await browserExpect(trigger).toBeDisabled();
    await page.evaluate(()=>window.update({}, {readonly:false,disabled:true}));await browserExpect(date).toBeDisabled();expect(await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('form'))))).toEqual({});
    await page.evaluate(()=>window.update({}, {disabled:false}));await trigger.click();await browserExpect(dialog).toBeVisible();
    await page.evaluate(()=>{document.querySelector('fieldset').disabled=true;});await browserExpect(dialog).not.toBeVisible();await browserExpect(trigger).toBeDisabled();
    expect(await page.evaluate(()=>window.native.every(id=>id==='due'))).toBe(true);
    await page.evaluate(()=>window.fresh());await trigger.click();await browserExpect(dialog).toBeVisible();await page.keyboard.press('Escape');await browserExpect(trigger).toBeFocused();
    await page.evaluate(()=>window.unmount());await page.evaluate(()=>window.dispatchEvent(new Event('resize')));expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
