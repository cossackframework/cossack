import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';

// Only these repository-owned examples are executed by the acceptance harness.
// CLI/MCP discovery returns source text and never calls this function.
export const applicationGuidanceExamples = [
  { guide: 'component-actions', example: 'validated-counter', route: 'guidance-actions' },
  { guide: 'server-resources', example: 'resource-page', route: 'guidance-resource' },
  { guide: 'lifecycle-tasks', example: 'owned-task', route: 'guidance-task' },
  { guide: 'safe-old-input', example: 'public-form-fields', route: 'guidance-old-input' },
];

export async function verifyApplicationGuidance(root, guides, { additionalAllowedPaths = [] } = {}) {
  const backups = new Map();
  let child, browser, exited;
  let output = '';
  try {
    for (const selected of applicationGuidanceExamples) {
      const example = guides.find(guide => guide.id === selected.guide)?.examples.find(example => example.id === selected.example);
      assert.ok(example, `Missing packaged application example ${selected.guide}/${selected.example}`);
      const file = path.join(root, 'src/pages', selected.route, 'index.ts');
      try { backups.set(file, await fs.readFile(file)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; backups.set(file, null); }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, example.source);
    }
    const require = createRequire(path.join(root, 'package.json'));
    const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    try {
      await promisify(execFile)(process.execPath, [tsc, '--noEmit'], { cwd: root, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) { throw new Error(`Application guide types: ${error.stdout}\n${error.stderr}`); }

    // Earlier trace cases rewrite the same temporary project's page graph.
    // Start with optimizer artifacts for this generated application only.
    await fs.rm(path.join(root, 'node_modules/.vite'), { recursive: true, force: true });

    child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { createServer } from 'vite';
      const server = await createServer({ root: ${JSON.stringify(root)}, logLevel: 'error', server: {
        host: '127.0.0.1', port: 0, fs: { allow: ${JSON.stringify([root, ...additionalAllowedPaths])} }
      } });
      await server.listen();
      console.log('GUIDANCE_ORIGIN=http://127.0.0.1:' + server.httpServer.address().port);
      process.once('message', async () => { await server.close(); process.exit(0); });
    `], { cwd: root, env: { ...process.env, NODE_ENV: 'development', VITEST: '', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    exited = once(child, 'exit');
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      return /GUIDANCE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    }, { timeout: 30000 }).toBeTruthy();
    const origin = /GUIDANCE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Observe timer creation/cleanup without adding test hooks to published code.
    await page.addInitScript(() => {
      const active = new Set();
      window.__guideTimers = active;
      window.__guideDocumentId = crypto.randomUUID();
      const start = window.setInterval.bind(window), stop = window.clearInterval.bind(window);
      const startTimeout = window.setTimeout.bind(window);
      window.setTimeout = (handler, delay, ...args) => {
        if (delay === 100 && window.__guideHoldSlow && typeof handler === 'function') {
          window.__guideHoldSlow = false;
          window.__guideReleaseSlow = () => handler(...args);
          return startTimeout(() => {}, 0);
        }
        return startTimeout(handler, delay, ...args);
      };
      window.setInterval = (handler, delay, ...args) => {
        const id = start(handler, delay, ...args);
        if (delay === 40) active.add(id);
        return id;
      };
      window.clearInterval = id => { active.delete(id); stop(id); };
    });
    const calls = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/crpc') calls.push(request.postDataJSON());
    });

    await page.goto(origin + '/guidance-actions');
    await page.waitForFunction(() => window.__cossackReady === true);
    await expect(page.locator('#guide-count')).toHaveText('0');
    await page.getByRole('button', { name: 'Add one', exact: true }).click();
    await expect(page.locator('#guide-count')).toHaveText('1');
    await expect(page.locator('#guide-loading')).toHaveText('0');
    const accepted = calls.find(call => call.action === 'increment');
    assert.ok(accepted, 'The public example must invoke a real server action');
    await page.getByRole('button', { name: 'Reject invalid input' }).click();
    await expect(page.getByRole('alert')).toHaveText('COSSACK_VALIDATION_FAILED');
    await expect(page.locator('#guide-count')).toHaveText('1');
    await expect(page.locator('#guide-loading')).toHaveText('0');
    const forged = await page.request.post(origin + '/crpc', {
      headers: { origin }, data: { ...accepted, payload: [{ amount: 1, canEdit: true }] },
    });
    assert.equal(forged.status(), 400);
    assert.equal((await forged.json()).code, 'COSSACK_VALIDATION_FAILED');
    await page.getByRole('button', { name: 'Add one', exact: true }).click();
    await expect(page.locator('#guide-count')).toHaveText('2');

    const firstResourceCall = calls.length;
    await page.goto(origin + '/guidance-resource');
    await page.waitForFunction(() => window.__cossackReady === true);
    await expect(page.locator('#guide-record')).toHaveText('Record 1');
    await expect(page.locator('#guide-resource-state')).toHaveText('ready');
    assert.equal(calls.length, firstResourceCall, 'SSR hydration must not duplicate the initial resource request');
    await page.getByRole('button', { name: 'Select two' }).click();
    await expect(page.locator('#guide-record')).toHaveText('Record 2');
    await page.getByRole('button', { name: 'Select failing record' }).click();
    await expect(page.locator('#guide-resource-state')).toHaveText('error');
    await expect(page.locator('#guide-record')).toHaveText('Record 2');
    await expect(page.getByRole('alert')).toHaveText('Record unavailable. Try another selection.');
    assert.ok(!(await page.locator('main').textContent()).includes('PRIVATE_GUIDE_RESOURCE'));
    await page.getByRole('button', { name: 'Select four' }).click();
    await expect(page.locator('#guide-resource-state')).toHaveText('ready');
    await expect(page.locator('#guide-record')).toHaveText('Record 4');
    await page.getByRole('button', { name: 'Refresh record' }).click();
    await expect(page.locator('#guide-resource-state')).toHaveText('ready');
    await expect.poll(() => calls.slice(firstResourceCall).length).toBe(4);
    assert.deepEqual(calls.slice(firstResourceCall).map(call => call.payload), [[2], [3], [4], [4]]);

    await page.goto(origin + '/guidance-task');
    await page.waitForFunction(() => window.__cossackReady === true);
    await expect(page.locator('#guide-task-result')).toHaveText('initial');
    await expect.poll(() => page.evaluate(() => window.__guideTimers.size)).toBe(1);
    await page.evaluate(() => { window.__guideHoldSlow = true; });
    await page.getByRole('button', { name: 'Slow query' }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__guideReleaseSlow)).toBe('function');
    await expect.poll(() => page.evaluate(() => window.__guideTimers.size)).toBe(0);
    await page.getByRole('button', { name: 'Fast query' }).click();
    await expect(page.locator('#guide-task-result')).toHaveText('fast');
    await expect.poll(() => page.evaluate(() => window.__guideTimers.size)).toBe(1);
    // Release ignored work only after its replacement commits. This proves
    // overlap rather than relying on browser/CI timing for the slow operation.
    await page.evaluate(async () => {
      window.__guideReleaseSlow();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(page.locator('#guide-task-result')).toHaveText('fast');
    await expect.poll(async () => Number(await page.locator('#guide-task-ticks').textContent())).toBeGreaterThan(1);
    const documentId = await page.evaluate(() => window.__guideDocumentId);
    await page.getByRole('link', { name: 'Leave example' }).click();
    await expect(page).toHaveURL(origin + '/');
    await expect.poll(() => page.evaluate(() => window.__guideTimers.size)).toBe(0);
    // A reload would also remove timers, so require navigation in the same document.
    assert.equal(await page.evaluate(() => window.__guideDocumentId), documentId);

    const formSecret = 'PRIVATE_GUIDE_FORM_PASSWORD';
    const formData = new FormData();
    formData.set('name', 'Guide reader'); formData.set('email', 'invalid');
    formData.set('profile[city]', 'Tokyo'); formData.set('password', formSecret);
    const posted = await fetch(origin + '/guidance-old-input', { method: 'POST', headers: { origin }, body: formData, redirect: 'manual' });
    assert.equal(posted.status, 302);
    assert.equal(posted.headers.get('location'), '/guidance-old-input');
    const cookieHeader = posted.headers.getSetCookie().find(value => value.startsWith('cossack_flash='));
    assert.match(cookieHeader, /HttpOnly;.*SameSite=Lax/);
    const cookie = cookieHeader.split(';')[0];
    const payload = JSON.parse(Buffer.from(cookie.slice('cossack_flash='.length).split('.')[0], 'base64url').toString('utf8'));
    assert.equal(payload.format, 'cossack-flash');
    assert.ok(payload.expiresAt > Date.now());
    assert.ok(payload.expiresAt <= Date.now() + 31_000);
    assert.deepEqual(payload.data, { __input: { name: 'Guide reader', email: 'invalid', profile: { city: 'Tokyo' } }, errors: { email: 'Enter a valid email.' } });
    assert.ok(!JSON.stringify(payload).includes(formSecret));
    const restored = await fetch(origin + '/guidance-old-input', { headers: { cookie } });
    assert.equal(restored.status, 200);
    const restoredText = await restored.text();
    assert.ok(!restoredText.includes(formSecret));
    const state = JSON.parse(restoredText.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)[1]).public;
    assert.deepEqual(state, { name: 'Guide reader', email: 'invalid', city: 'Tokyo', errors: { email: 'Enter a valid email.' }, notice: '' });
    assert.match(restored.headers.get('set-cookie'), /cossack_flash=;.*Max-Age=0/);
    await page.goto(origin + '/guidance-old-input');
    await page.waitForFunction(() => window.__cossackReady === true);
    await page.getByLabel('Name', { exact: true }).fill('Browser reader');
    await page.getByLabel('Email', { exact: true }).fill('invalid');
    await page.getByLabel('City', { exact: true }).fill('Kyoto');
    await page.getByLabel('Password', { exact: true }).fill(formSecret);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter a valid email.');
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Browser reader');
    await expect(page.getByLabel('City', { exact: true })).toHaveValue('Kyoto');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await page.reload();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
    await expect(page.getByRole('alert')).toHaveText('');
    assert.deepEqual(errors, []);

    child.send('close');
    const closeTimeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited;
    clearTimeout(closeTimeout);
    assert.deepEqual({ code, signal }, { code: 0, signal: null }, output);
    child = undefined;

    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    try {
      await promisify(execFile)(process.execPath, [vite, 'build', '--sourcemap'], {
        cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'production', VITEST: '', WRANGLER_SEND_METRICS: 'false' },
      });
    } catch (error) { throw new Error(`Application guide production build: ${error.stdout}\n${error.stderr}`); }
    let maps = 0;
    const scan = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await scan(file);
        else if (/\.(?:js|map)$/.test(entry.name)) {
          if (entry.name.endsWith('.map')) maps++;
          const source = await fs.readFile(file, 'utf8');
          for (const marker of ['PRIVATE_GUIDE_ACTION', 'PRIVATE_GUIDE_RESOURCE']) assert.ok(!source.includes(marker), `Server-only marker leaked into ${file}`);
        }
      }
    };
    await scan(path.join(root, 'dist/client'));
    assert.ok(maps > 0, 'Client source maps must be emitted before checking source stripping');
  } catch (error) {
    throw new Error(`Application guidance acceptance: ${error.message}\n${output}`, { cause: error });
  } finally {
    await browser?.close();
    if (child) {
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
      await exited;
      clearTimeout(kill);
    }
    for (const [file, backup] of backups) {
      if (backup === null) await fs.rm(file, { force: true });
      else await fs.writeFile(file, backup);
    }
  }
}
