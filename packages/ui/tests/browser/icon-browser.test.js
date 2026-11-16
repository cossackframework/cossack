import { launchBrowser } from './helpers.js';
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
import { Icon } from '../../dist/index.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));

// A sprite icon keeps its <use href> through hydration and client renders: the dashboard draws every
// icon this way, and a leaked template placeholder once sent the browser to /__CRP_0__.
it('draws sprite icons as <use> on the client, with the href bound', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-icon-'));
  let server, browser;
  const templateSource = `(p={})=>html\`<p>\${component(Icon,{id:'home',entry:{href:p.href??'/icons.svg#home'},size:16})}\${component(Icon,{id:'named',entry:{href:'/icons.svg#star'},label:'Starred'})}</p>\``;
  const template = new Function('html', 'component', 'Icon', `return (${templateSource})`)(html, component, Icon);
  try {
    const scope = path.join(root, 'node_modules/@cossackframework'); await fs.mkdir(scope, { recursive: true });
    for (const name of ['renderer', 'core', 'ui']) await fs.symlink(path.join(repository, 'packages', name), path.join(scope, name), 'dir');
    await fs.writeFile(path.join(root, 'index.html'), `<html><head><meta charset="utf-8"></head><body><main id="app">${minifyHtml(renderToString(template(), { hydrate: true }))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root, 'main.js'), `
import {html,hydrate,render,component} from '@cossackframework/renderer';
import {Icon} from '@cossackframework/ui';
const template=${templateSource},container=document.querySelector('#app');let props={};
window.update=patch=>{props={...props,...patch};render(template(props),container);};
hydrate(template(props),container);window.hydrated=true;
`);
    await build({ root, configFile: false, logLevel: 'silent', build: { outDir: 'dist', emptyOutDir: true } });
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html'); response.end(await fs.readFile(file)); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await launchBrowser();
    const page = await browser.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.hydrated === true);
    const use = page.locator('#home use');
    await browserExpect(use).toHaveAttribute('href', '/icons.svg#home');
    expect(await use.evaluate(el => el.namespaceURI)).toBe('http://www.w3.org/2000/svg');
    await browserExpect(page.locator('#named')).toHaveAccessibleName('Starred');
    await page.evaluate(() => window.update({ href: '/icons.svg?v=2#home' }));
    await browserExpect(use).toHaveAttribute('href', '/icons.svg?v=2#home');
    expect(errors).toEqual([]);
    expect(requests.filter(p => p.includes('CRP'))).toEqual([]);
  } finally {
    await browser?.close();
    await new Promise(resolve => server ? server.close(resolve) : resolve());
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
