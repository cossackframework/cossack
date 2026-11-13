import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);

/** Execute the public installation/deployment path with an already installed tarball tree. */
export async function verifyDeploymentGuide(projectDir) {
  const installed = await fs.realpath(path.join(projectDir, 'node_modules/cossack'));
  assert.ok(installed.startsWith(projectDir + path.sep), 'Guide acceptance requires an installed CLI');
  const cli = path.join(installed, 'bin/cossack.js');
  const scratch = await fs.mkdtemp(path.join(projectDir, '.deployment-guide-'));
  const env = { ...process.env, PATH: `${path.join(projectDir, 'node_modules/.bin')}${path.delimiter}${process.env.PATH ?? ''}`, CLOUDFLARE_ENV: '', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_API_KEY: '',
    CLOUDFLARE_EMAIL: '', CLOUDFLARE_ACCOUNT_ID: '', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_HIDE_BANNER: 'true', DO_NOT_TRACK: '1',
    // Miniflare otherwise fetches a cached cf metadata sample even for local type generation.
    CLOUDFLARE_CF_FETCH_ENABLED: 'false', CI: 'true' };
  const guard = path.join(scratch, 'offline.cjs');
  const attempts = path.join(scratch, 'remote-attempts');
  await fs.writeFile(guard, `const fs=require('node:fs');
const local=host=>host==='localhost'||host==='127.0.0.1'||host==='::1';
const deny=host=>{fs.appendFileSync(${JSON.stringify(attempts)},JSON.stringify({host,tool:require('node:path').basename(process.argv[1]??''),stack:new Error().stack.split('\\n').slice(1,7)})+'\\n');throw Error('DEPLOYMENT_GUIDE_REMOTE_REQUEST');};
const fetch=globalThis.fetch;globalThis.fetch=(input,...args)=>{const host=new URL(typeof input==='string'||input instanceof URL?input:input.url).hostname;if(!local(host))deny(host);return fetch(input,...args);};
const net=require('node:net'), connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const normalized=Array.isArray(args[0])?args[0]:args;const opts=normalized[0];const host=typeof opts==='object'?opts.host:(typeof normalized[1]==='string'?normalized[1]:'localhost');if(typeof opts==='object'&&opts.path)return connect.apply(this,args);if(!local(host??'localhost'))deny(host);return connect.apply(this,args);};
require('node:module').syncBuiltinESMExports();`);
  env.NODE_OPTIONS = `--require=${guard}`;
  env.NODE_PATH = '';
  env.COSSACK_DISABLE_UPDATE_CHECK = '1';
  const receipts = [];
  async function invoke(cwd, args, expected = true) {
    let result;
    try { result = await exec(process.execPath, [cli, ...args, '--json'], { cwd, env, timeout: 180000, maxBuffer: 8 * 1024 * 1024 }); }
    catch (error) { if (!error.stdout) throw error; result = error; }
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, expected, `${args.join(' ')}: ${JSON.stringify(envelope.diagnostics)}`);
    receipts.push({ command: args, ok: envelope.ok, diagnostics: envelope.diagnostics?.map(item => item.code) ?? [] });
    return envelope;
  }
  try {
    await invoke(scratch, ['create', 'guide-app', '--adapter=cloudflare', '--preset=minimal', '--yes', '--package-manager=pnpm']);
    const root = path.join(scratch, 'guide-app');
    await fs.symlink(path.join(projectDir, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    const configFile = path.join(root, 'wrangler.jsonc');
    const original = await fs.readFile(configFile, 'utf8');
    const initial = await invoke(root, ['check', 'cloudflare'], false);
    assert.ok(initial.diagnostics.some(item => item.code === 'COSSACK_APP_URL_INVALID'), 'Generated placeholder must fail before upload');
    // This is the public, documented production URL setting, not a private fixture bridge.
    await fs.writeFile(configFile, original.replace('https://example.com', 'https://guide-acceptance.cossack.test'));
    await invoke(root, ['inspect', 'cloudflare']);
    await invoke(root, ['check', 'cloudflare']);
    await invoke(root, ['build']);
    const dryRun = await invoke(root, ['deploy', '--dry-run']);
    assert.ok(dryRun.data.steps.length > 0);
    assert.ok(dryRun.data.steps.every(step => step.exitCode === 0));
    assert.ok(dryRun.data.artifact);
    const config = JSON.parse(original.replace(/^\s*\/\/.*$/gm, ''));
    config.vars.APP_URL = 'https://guide-acceptance.cossack.test';
    config.env = { staging: {
      name: 'guide-app-staging', vars: { ...config.vars, APP_URL: 'https://staging-guide.cossack.test' },
      durable_objects: config.durable_objects, secrets: { required: ['APP_SECRET', 'GUIDE_DEPLOY_SECRET'] },
      routes: [{ pattern: 'staging-guide.cossack.test', custom_domain: true },
        { pattern: 'routes-guide.cossack.test/*', zone_name: 'cossack.test' }],
    } };
    await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    await fs.writeFile(path.join(root, '.dev.vars.staging'), 'APP_SECRET=local-guide-only\nGUIDE_DEPLOY_SECRET=local-guide-only\n');
    // These are authored public application pages, consumed by the generated SSG plugin.
    const page = path.join(root, 'src/pages/guide-static');
    await fs.mkdir(page, { recursive: true });
    await fs.writeFile(path.join(page, 'index.ts'), `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
@Page({ transport: 'http', ssg: true })
export default class GuideStatic extends Cossack { render() { return html\`<h1>Guide static acceptance</h1>\`; } }
`);
    const selected = await invoke(root, ['inspect', 'cloudflare', '--env', 'staging']);
    assert.ok(JSON.stringify(selected.data).includes('guide-app-staging'));
    await invoke(root, ['check', 'cloudflare', '--env', 'staging']);
    await invoke(root, ['build', '--env', 'staging', '--mode', 'development']);
    await invoke(root, ['ssg', '--env', 'staging']);
    const html = await fs.readFile(path.join(root, 'dist/client/guide-static/index.html'), 'utf8');
    assert.ok(html.includes('Guide static acceptance'));
    const sitemap = await fs.readFile(path.join(root, 'dist/client/sitemap.xml'), 'utf8');
    assert.ok(sitemap.includes('https://staging-guide.cossack.test/guide-static'));
    // Local SSG needs local secrets, but the final deploy dry-run must not claim remote ones exist.
    await fs.rm(path.join(root, '.dev.vars.staging'));
    await fs.rm(path.join(root, '.dev.vars'));
    const stagedDryRun = await invoke(root, ['deploy', '--env', 'staging', '--dry-run']);
    assert.equal(stagedDryRun.data.environment, 'staging');
    assert.ok(stagedDryRun.data.steps.every(step => step.exitCode === 0));
    const artifact = JSON.parse(await fs.readFile(stagedDryRun.data.artifact, 'utf8'));
    assert.equal(artifact.name, 'guide-app-staging');
    assert.deepEqual(artifact.routes, config.env.staging.routes);
    assert.equal(artifact.vars.APP_URL, 'https://staging-guide.cossack.test');
    assert.deepEqual(artifact.secrets.required, ['APP_SECRET', 'GUIDE_DEPLOY_SECRET']);
    assert.equal(artifact.compatibility_date, config.compatibility_date);
    assert.deepEqual(artifact.compatibility_flags, config.compatibility_flags);
    const server = net.createServer();
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    const dev = spawn(process.execPath, [cli, 'dev', '--env', 'staging', '--host', '127.0.0.1', '--port', String(port), '--json'],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = ''; let errorOutput = ''; let exit;
    const closed = new Promise(resolve => dev.on('close', code => { exit = code; resolve(code); }));
    dev.stdout.on('data', chunk => { output += chunk; });
    dev.stderr.on('data', chunk => { errorOutput += chunk; });
    dev.on('error', error => { errorOutput += error.message; });
    const stop = signal => { try { if(process.platform!=='win32') process.kill(-dev.pid, signal); else dev.kill(signal); } catch {} };
    try {
      const deadline = Date.now() + 60000;
      let ready = false;
      while(Date.now() < deadline && exit === undefined) {
        try { const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
          if(response.status===200) { await response.text(); ready=true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!ready) {
        // The JSON lifecycle keeps the child's output out of the protocol; rerun plainly to learn why Vite stopped.
        const plain = await new Promise(resolve => { let text = ''; const retry = spawn(process.execPath, [cli, 'dev', '--env', 'staging', '--host', '127.0.0.1', '--port', String(port + 1)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
          retry.stdout.on('data', chunk => { text += chunk; }); retry.stderr.on('data', chunk => { text += chunk; });
          const timer = setTimeout(() => retry.kill('SIGKILL'), 45000); retry.on('close', () => { clearTimeout(timer); resolve(text); }); });
        assert.fail(`Named environment dev must serve HTTP (exit ${exit}): ${errorOutput}\n--- dev --json stdout ---\n${output.slice(-3000)}\n--- dev without --json ---\n${plain.slice(-6000)}`);
      }
      stop('SIGTERM');
      const stopped = await Promise.race([closed, new Promise(resolve => { const timer=setTimeout(()=>resolve('timeout'),15000); timer.unref(); })]);
      assert.notEqual(stopped, 'timeout', 'Development command must drain');
      const events=output.split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line));
      assert.ok(events.length>=2);
      receipts.push({command:['dev','--env','staging'],ok:true,httpStatus:200,stopped:true});
    } finally { stop('SIGKILL'); await closed; }
    const invalid = await invoke(root, ['check', 'cloudflare', '--env', 'undeclared'], false);
    assert.ok(invalid.diagnostics.length);
    const wranglerBin = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
    for (const args of [['secret', 'put', 'APP_SECRET', '--env', 'staging', '--help'],
      ['d1', 'create', 'guide-db', '--update-config', '--binding', 'DB', '--env', 'staging', '--help']]) {
      const help = await exec(process.execPath, [wranglerBin, ...args], { cwd: root, env, timeout: 30000 });
      assert.ok(help.stdout.includes('--env'));
      receipts.push({ command: ['wrangler', ...args], ok: true, scope: 'help-only-no-mutation' });
    }
    const versions = {};
    for (const name of ['cossack', '@cossackframework/framework', 'vite', '@cloudflare/vite-plugin', 'wrangler']) {
      versions[name] = JSON.parse(await fs.readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    }
    const unsupported = path.join(scratch, 'unsupported');
    await fs.mkdir(path.join(unsupported, 'node_modules/wrangler'), { recursive: true });
    await fs.writeFile(path.join(unsupported, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(unsupported, 'wrangler.jsonc'), original);
    await fs.writeFile(path.join(unsupported, 'node_modules/wrangler/package.json'), '{"name":"wrangler","type":"module","exports":"./index.js"}');
    await fs.writeFile(path.join(unsupported, 'node_modules/wrangler/index.js'), 'export default {};');
    const unavailable = await invoke(unsupported, ['check', 'cloudflare'], false);
    assert.ok(unavailable.diagnostics.some(item => item.code === 'COSSACK_WRANGLER_API_UNSUPPORTED'), 'Unsupported parser must produce actionable Wrangler diagnostics');
    assert.equal(await fs.readFile(attempts, 'utf8').catch(error => { if(error.code==='ENOENT') return ''; throw error; }), '', 'No remote requests permitted');
    return { schemaVersion: 1, scope: 'local-generated-guide', versions, receipts, remoteReadiness: 'not-checked' };
  } finally { if (process.env.COSSACK_KEEP_SMOKE !== '1') await fs.rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'Usage: node scripts/verify-deployment-guide.mjs <installed-project>');
  console.log(JSON.stringify(await verifyDeploymentGuide(path.resolve(process.argv[2])), null, 2));
}
