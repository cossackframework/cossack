import { launchBrowser, tailwind, repository, toolRequire, standardStyle } from './helpers.js';
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

const { build } = await import(toolRequire.resolve('vite'));

// Refs run before a client render adopts its cloned nodes into the document,
// so a control that walks parentElement synchronously never finds its fieldset.
it('closes client-mounted Combobox and Popover popups when their fieldset is disabled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-fieldset-mount-'));
  let server, browser;
  try {
    const scope = path.join(root, 'node_modules', '@cossackframework');
    await fs.mkdir(scope, { recursive: true });
    for (const name of ['renderer', 'core', 'ui']) await fs.symlink(path.join(repository, 'packages', name), path.join(scope, name), 'dir');
    await fs.writeFile(path.join(root, 'index.html'), '<html><head><meta charset="utf-8"></head><body><main id="app"></main><script type="module" src="/main.js"></script></body></html>');
    await fs.writeFile(path.join(root, 'style.css'), standardStyle());
    await fs.writeFile(path.join(root, 'main.js'), `
import './style.css';
import {html,render,component} from '@cossackframework/renderer';
import {Combobox,Popover} from '@cossackframework/ui';
render(html\`<fieldset id="combo-set">\${component(Combobox,{id:'fruit','aria-label':'Fruit',options:[{value:'a',label:'Apple'},{value:'b',label:'Banana'}]})}</fieldset>
  <fieldset id="popover-set">\${component(Popover,{id:'info',trigger:'Info',side:'bottom'},html\`<p>Details</p>\`)}</fieldset>\`,document.querySelector('#app'));
window.ready=true;
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
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);

    const input = page.getByRole('combobox', { name: 'Fruit' }), list = page.locator('#fruit-listbox');
    await input.focus(); await input.press('ArrowDown');
    await browserExpect(list).toBeVisible();
    await page.evaluate(() => { document.querySelector('#combo-set').disabled = true; });
    await browserExpect(list).not.toBeVisible();
    await browserExpect(input).toHaveAttribute('aria-expanded', 'false');

    const panel = page.locator('#info-content');
    await page.getByRole('button', { name: 'Info' }).click();
    await browserExpect(panel).toBeVisible();
    await page.evaluate(() => { document.querySelector('#popover-set').disabled = true; });
    await browserExpect(panel).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
