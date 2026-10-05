import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';

const exec = promisify(execFile);
const SECRET = 'RT24_PRIVATE_BINDING_VALUE_SENTINEL';
const SOURCE = 'RT24_PRIVATE_FACTORY_SOURCE_SENTINEL';
const CLASSIFICATION = 'COSSACK_HYDRATION_SECRET';
const markers = [SECRET, SOURCE];
function privateAbsent(text, location) {
  for (const marker of markers) assert.ok(!text.includes(marker), `Private configuration leaked into ${location}`);
}

/** Installed application acceptance: private config is read, but never published as public state. */
export async function verifyConfigHydration(projectDir) {
  const require = createRequire(path.join(projectDir, 'package.json'));
  const framework = await fs.realpath(path.join(projectDir, 'node_modules/@cossackframework/framework'));
  assert.ok(framework.startsWith(projectDir + path.sep), 'Use an installed framework tarball');
  const scratch = path.join(projectDir, '.config-hydration-acceptance');
  await fs.mkdir(scratch); // Refuse to replace any authored acceptance directory.
  const backups = new Map();
  const directories = [];
  const createdDirectories = new Set();
  let child, browser, exited;
  let output = '';
  const save = async file => {
    if (backups.has(file)) return;
    try { backups.set(file, await fs.readFile(file)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; backups.set(file, null); }
  };
  const write = async (file, source) => {
    await save(file);
    for (let directory = path.dirname(file); directory !== projectDir; directory = path.dirname(directory)) {
      try { await fs.access(directory); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; createdDirectories.add(directory); }
    }
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, source);
  };
  const preserveDirectory = async (file, name) => {
    const backup = path.join(scratch, name);
    try { await fs.rename(file, backup); directories.push({ file, backup }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; directories.push({ file, backup: null }); }
  };
  try {
    for (const file of ['.cossack/config.d.ts', '.cossack/routes.ts']) await save(path.join(projectDir, file));
    await preserveDirectory(path.join(projectDir, 'dist'), 'original-dist');
    await preserveDirectory(path.join(projectDir, '.wrangler'), 'original-wrangler');
    await preserveDirectory(path.join(projectDir, 'node_modules/.vite'), 'original-vite-cache');
    // Wrangler's declared secret names control local binding injection.
    const wranglerConfig = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].map(name => path.join(projectDir, name));
    for (const configFile of wranglerConfig) {
      try { await fs.access(configFile); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const wrangler = await import(require.resolve('wrangler'));
      const { rawConfig } = wrangler.experimental_readRawConfig({ config: configFile });
      const required = [...new Set([...(rawConfig.secrets?.required ?? []), CLASSIFICATION])];
      // This acceptance targets generated JSON/JSONC applications.
      if (configFile.endsWith('.toml')) throw new Error('Config hydration acceptance requires a generated Wrangler JSON/JSONC application.');
      await write(configFile, JSON.stringify({ ...rawConfig, secrets: { ...rawConfig.secrets, required } }, null, 2));
      break;
    }
    const devVars = path.join(projectDir, '.dev.vars');
    await save(devVars);
    await write(devVars, (backups.get(devVars)?.toString('utf8') ?? '') + `\n${CLASSIFICATION}=${JSON.stringify(SECRET)}\n`);
    // Node/Deno adapters use Vite dotenv instead of Workers dev.vars.
    const dotenv = path.join(projectDir, '.env.local');
    await save(dotenv);
    await write(dotenv, (backups.get(dotenv)?.toString('utf8') ?? '') + `\n${CLASSIFICATION}=${JSON.stringify(SECRET)}\n`);
    await write(path.join(projectDir, 'src/config/config_hydration_private.ts'), `
import type { ConfigRequirements, EnvFunction } from '@cossackframework/framework/config';
export const requirements = { variables: { ${CLASSIFICATION}: { type: 'string', secret: true, runtimes: ['cloudflare', 'node', 'deno'] } } } as const satisfies ConfigRequirements;
export default ({ env }: { env: EnvFunction }) => ({ token: env('${CLASSIFICATION}'), source: '${SOURCE}' });
`);
    await write(path.join(projectDir, 'src/pages/config-hydration-acceptance/index.ts'), `
import { Cossack, Page, State, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { config, requireConfigVariable } from '@cossackframework/framework/config';
@Page({ transport: 'http' })
export default class ConfigHydrationAcceptance extends Cossack {
  @State() ready = false;
  @State() count = 0;
  private token = '';
  async init() {
    this.token = requireConfigVariable('${CLASSIFICATION}', 'string');
    this.ready = this.token.length > 0 && config('config_hydration_private.token') === this.token && typeof config('config_hydration_private.source') === 'string';
  }
  @Server() increment() {
    this.token = requireConfigVariable('${CLASSIFICATION}', 'string');
    if (!this.token || config('config_hydration_private.token') !== this.token) throw new Error('Private configuration scope was lost.');
    this.count++;
  }
  render() { return html\`<main><span id="config-private-ready">\${this.ready ? 'ready' : 'missing'}</span><span id="config-public-count">\${this.count}</span><button @click=\${() => this.increment()}>Increment public count</button></main>\`; }
}
`);
    const cli = path.join(await fs.realpath(path.join(projectDir, 'node_modules/cossack')), 'bin/cossack.js');
    const cliEnv = { ...process.env, CLOUDFLARE_ENV: '', WRANGLER_SEND_METRICS: 'false' };
    for (const args of [['config', '--generate'], ['config', '--check'], ['inspect', 'cloudflare']]) {
      const result = await exec(process.execPath, [cli, ...args, '--json'], { cwd: projectDir, env: cliEnv, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      privateAbsent(result.stdout + result.stderr, `installed CLI ${args.join(' ')}`);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.ok, true);
      if (args[0] === 'config' && args.includes('--check')) {
        assert.equal(envelope.data.remoteSecrets, 'not-checked');
        assert.ok(envelope.data.unverifiedSecrets.includes(CLASSIFICATION));
      }
    }
    const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    await exec(process.execPath, [compiler, '--noEmit'], { cwd: projectDir, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { createServer } from 'vite';
      const server = await createServer({ root: ${JSON.stringify(projectDir)}, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
      await server.listen();
      console.log('CONFIG_HYDRATION_ORIGIN=http://127.0.0.1:' + server.httpServer.address().port);
      process.once('message', async () => { await server.close(); process.exit(0); });
    `], { cwd: projectDir, env: { ...process.env, CLOUDFLARE_ENV: '', NODE_ENV: 'development', VITEST: '', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    exited = once(child, 'exit');
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error('Installed application exited during config hydration startup.');
      return /CONFIG_HYDRATION_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    }, { timeout: 30000 }).toBeTruthy();
    const origin = /CONFIG_HYDRATION_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    const route = origin + '/config-hydration-acceptance';
    const response = await fetch(route);
    const html = await response.text();
    if (response.status !== 200) {
      const sanitized = markers.reduce((text, marker) => text.replaceAll(marker, '[private acceptance sentinel]'), html + '\n' + output);
      throw new Error('Configuration SSR failed before successful hydration: ' + sanitized);
    }
    privateAbsent(html, 'SSR HTML');
    const match = html.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s);
    assert.ok(match, 'SSR must emit actual hydration state');
    const initialState = JSON.parse(match[1]);
    privateAbsent(JSON.stringify(initialState), 'SSR initial state');
    assert.equal(initialState.public.ready, true); assert.equal(initialState.public.count, 0);
    assert.ok(!Object.hasOwn(initialState.public, 'token'));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [], networkBodies = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/crpc') requests.push(request.postData() ?? '');
    });
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname === '/crpc' || response.request().resourceType() === 'script') {
        networkBodies.push(response.text().then(text => ({ pathname, text })));
      }
    });
    await page.goto(route);
    await page.waitForFunction(() => window.__cossackReady === true);
    await expect(page.locator('#config-private-ready')).toHaveText('ready');
    await expect(page.locator('#config-public-count')).toHaveText('0');
    const browserState = await page.evaluate(() => window.__INITIAL_STATE__);
    privateAbsent(JSON.stringify(browserState), 'browser initial state');
    await page.getByRole('button', { name: 'Increment public count', exact: true }).click();
    await expect(page.locator('#config-public-count')).toHaveText('1');
    assert.ok(requests.length > 0, 'The button must invoke a real server RPC');
    for (const request of requests) privateAbsent(request, 'browser RPC request');
    const bodies = await Promise.all(networkBodies);
    assert.ok(bodies.some(body => body.pathname === '/crpc'), 'Capture the real RPC response');
    assert.ok(bodies.some(body => body.pathname.endsWith('.ts')), 'Capture delivered application JavaScript');
    for (const body of bodies) privateAbsent(body.text, `browser response ${body.pathname}`);
    assert.deepEqual(errors, []);
    privateAbsent(output, 'development server output');
    await browser.close(); browser = undefined;
    child.send('close');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited; clearTimeout(timeout);
    assert.deepEqual({ code, signal }, { code: 0, signal: null }); child = undefined;
    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    const built = await exec(process.execPath, [vite, 'build', '--sourcemap'], { cwd: projectDir, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_ENV: '', NODE_ENV: 'production', VITEST: '', WRANGLER_SEND_METRICS: 'false' } });
    privateAbsent(built.stdout + built.stderr, 'production build diagnostics');
    let scripts = 0, maps = 0;
    const scan = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await scan(file);
        else if (/\.(?:js|map)$/.test(entry.name)) {
          if (entry.name.endsWith('.map')) maps++; else scripts++;
          const source = await fs.readFile(file, 'utf8'); privateAbsent(source, 'production client asset');
          assert.ok(!source.includes(CLASSIFICATION), 'Server config declaration leaked into production client asset');
        }
      }
    };
    await scan(path.join(projectDir, 'dist/client'));
    assert.ok(scripts > 0 && maps > 0, 'Verify emitted scripts and source maps, not an empty asset set');
    console.log('Installed private config SSR hydration, browser/RPC, CLI metadata and production client/source-map secrecy acceptance passed.');
  } finally {
    await browser?.close();
    if (child) {
      child.kill('SIGTERM'); const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
      await exited; clearTimeout(timeout);
    }
    for (const { file, backup } of directories.reverse()) {
      await fs.rm(file, { recursive: true, force: true });
      if (backup) await fs.rename(backup, file);
    }
    for (const [file, backup] of backups) {
      if (backup === null) await fs.rm(file, { force: true }); else await fs.writeFile(file, backup);
    }
    for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      try { await fs.rmdir(directory); } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
    }
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
