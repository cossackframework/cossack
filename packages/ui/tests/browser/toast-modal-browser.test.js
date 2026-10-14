import { launchBrowser, tailwind, repository, toolRequire, standardStyle } from './helpers.js';
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

const { build } = await import(toolRequire.resolve('vite'));

// A modal <dialog> sits in the top layer and makes the rest of the document
// inert. The Toaster must stay above it, visible and dismissible.
it('keeps toasts visible and dismissible above an open modal dialog', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-toast-modal-'));
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
import {Toaster,Modal,toast} from '@cossackframework/ui';
const container=document.querySelector('#app');let open=false;
function draw(){render(html\`\${component(Toaster,{position:'top-right'})}
  \${component(Modal,{open,'aria-label':'Settings',onOpenChange:value=>{open=value;draw();}},html\`<p>Modal body</p><button type="button" id="inside">Inside</button>\`)}\`,container);}
window.toast=toast;window.setOpen=value=>{open=value;draw();};draw();window.ready=true;
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
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    const region = page.getByRole('region', { name: 'Notifications' });
    const topmost = id => page.evaluate(id => {
      const item = document.querySelector(`[data-toast-id="${id}"]`), rect = item.getBoundingClientRect();
      return item.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    }, id);

    // A toast shown before the modal opens stays on top of it.
    const before = await page.evaluate(() => window.toast.show('Before modal', { duration: 0 }));
    await page.evaluate(() => window.setOpen(true));
    await browserExpect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await browserExpect(region.locator('[data-toast-id]', { hasText: 'Before modal' })).toBeVisible();
    await browserExpect.poll(() => topmost(before)).toBe(true);

    // A toast shown while the modal is open is visible and clickable.
    const during = await page.evaluate(() => window.toast.error('Save failed', { duration: 0 }));
    await browserExpect(region.locator('[data-toast-id]', { hasText: 'Save failed' })).toBeVisible();
    await browserExpect.poll(() => topmost(during)).toBe(true);
    await region.getByRole('button', { name: 'Dismiss: Save failed' }).click();
    await browserExpect(region.locator('[data-toast-id]', { hasText: 'Save failed' })).toHaveCount(0);
    await browserExpect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    // Closing the modal leaves the toaster usable.
    await page.evaluate(() => window.setOpen(false));
    await region.getByRole('button', { name: 'Dismiss: Before modal' }).click();
    await browserExpect(region.locator('[data-toast-id]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120000);
