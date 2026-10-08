import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';

const execute = promisify(execFile);
const deployModule = 'jsr:@deno/deploy@0.0.9908';

// Explicitly opt in: this harness creates and deletes one real hosted app.
// Tokens are inherited through the environment, never placed in CLI arguments.
export async function verifyDenoDeployHosted({ installedRoot, binary, deploy = false, preparedUpload }) {
  assert(installedRoot, 'A verified installed tarball consumer is required');
  assert(binary, 'An explicit native Deno binary is required');
  const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-deno-hosted-'));
  await fs.chmod(evidence, 0o700);
  const require = createRequire(path.join(installedRoot, 'package.json'));
  let sequence = 0;
  async function command(executable, args, cwd = evidence, environment = {}) {
    const log = path.join(evidence, `${++sequence}.log`);
    try {
      const result = await execute(executable, args, {
        cwd,
        timeout: 300000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, VITEST: '', COSSACK_DISABLE_UPDATE_CHECK: '1', ...environment },
      });
      await fs.writeFile(log, result.stderr + '\n' + result.stdout, { mode: 0o600 });
      return result.stdout;
    } catch (error) {
      await fs.writeFile(log, String(error.stderr ?? '') + '\n' + String(error.stdout ?? ''), { mode: 0o600 });
      throw new Error(`Native command failed; private evidence: ${log}`, { cause: error.code });
    }
  }
  const upload = path.join(evidence, 'upload');
  const runtime = { type: 'dynamic', entrypoint: 'dist/server/index.js' };
  if (preparedUpload) {
    const previous = JSON.parse(await fs.readFile(path.join(path.dirname(preparedUpload), 'prepared.json'), 'utf8'));
    assert.equal(previous.installedRoot, installedRoot);
    assert.equal(previous.binary, binary);
    await fs.cp(preparedUpload, upload, { recursive: true });
    await fs.writeFile(
      path.join(evidence, 'prepared.json'),
      JSON.stringify({ upload, installedRoot, binary, deployModule, reused: preparedUpload }),
      { mode: 0o600 },
    );
  } else {
    const cli = path.join(installedRoot, 'node_modules/cossack/bin/cossack.js');
    const created = JSON.parse(
      await command(process.execPath, [
        cli,
        'create',
        'app',
        '--adapter',
        'deno',
        '--preset',
        'minimal',
        '--yes',
        '--json',
      ]),
    );
    assert.equal(created.ok, true);
    const root = path.join(evidence, 'app');
    await fs.symlink(path.join(installedRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    const marker = `DENO_HOSTED_SERVER_ONLY_${randomUUID()}`;
    for (const [route, transport] of [
      ['hosted-http', 'http'],
      ['hosted-sse', 'sse'],
      ['hosted-live', 'durable-object'],
    ]) {
      const directory = path.join(root, 'src/pages', route);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        path.join(directory, 'index.ts'),
        `
import {Cossack,Page,State,Server} from '@cossackframework/core';
import {html} from '@cossackframework/renderer';
@Page({transport:'${transport}',stateful:false}) export default class HostedAcceptance extends Cossack {
 @State() count=0;
 @Server() increment(){const marker='${marker}';this.count+=2;return {marker,runtime:Deno.version.deno};}
 render(){return html\`<main><h1>Deno hosted acceptance</h1><span id="count">\${this.count}</span><button @click="\${()=>this.increment()}">Increment</button></main>\`;}
}
`,
      );
    }
    const api = path.join(root, 'src/pages/api/hosted-check.ts');
    await fs.mkdir(path.dirname(api), { recursive: true });
    await fs.writeFile(
      api,
      `import {defineApi} from '@cossackframework/framework/api';
export const POST=defineApi({handler:async({c})=>{
 const headers=new Headers({'content-type':'application/json'});
 headers.append('set-cookie','first=1; Path=/');headers.append('set-cookie','second=2; Path=/');
 return new Response(JSON.stringify({runtime:Deno.version.deno,body:await c.req.text()}),{headers});
}});`,
    );
    // The release artifacts have private file: tarball dependencies. Bundle runtime
    // packages for upload instead of requiring those paths on the provider.
    const config = path.join(root, 'vite.config.ts');
    await fs.rename(config, path.join(root, 'vite.config.generated.ts'));
    await fs.writeFile(
      config,
      `import generated from './vite.config.generated';
import {mergeConfig,defineConfig} from 'vite';
export default defineConfig(env=>mergeConfig(typeof generated==='function'?generated(env):generated,
 {environments:{ssr:{resolve:{noExternal:true}}}}));`,
    );
    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    await command(process.execPath, [vite, 'build'], root, { NODE_ENV: 'production' });
    await command(process.execPath, [vite, 'build', '--ssr', 'src/index.ts', '--outDir', 'dist/server'], root, {
      NODE_ENV: 'production',
    });
    await fs.mkdir(upload);
    await fs.cp(path.join(root, 'dist'), path.join(upload, 'dist'), { recursive: true });
    // Private authored server sourcemaps are never needed to execute this artifact.
    async function inspect(directory, client) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await inspect(file, client);
        else if (entry.name.endsWith('.map')) await fs.rm(file);
        else if (entry.name.endsWith('.js')) {
          const source = await fs.readFile(file, 'utf8');
          assert(!source.includes('cloudflare:workers'), file);
          if (client) assert(!source.includes(marker), file);
        }
      }
    }
    await inspect(path.join(upload, 'dist/client'), true);
    await inspect(path.join(upload, 'dist/server'), false);
    await fs.writeFile(path.join(upload, 'deno.json'), '{}\n');
    await fs.writeFile(
      path.join(upload, 'package.json'),
      JSON.stringify({ name: 'cossack-deno-hosted-acceptance', private: true, type: 'module' }),
    );
    await command(
      binary,
      ['check', '--no-config', '--node-modules-dir=none', '--cached-only', 'dist/server/index.js'],
      upload,
    );
    await fs.writeFile(
      path.join(evidence, 'prepared.json'),
      JSON.stringify({ upload, installedRoot, binary, deployModule }, null, 2),
      { mode: 0o600 },
    );
  }
  if (!deploy) return { prepared: true, evidence, upload, hosted: false };

  assert(process.env.DENO_DEPLOY_TOKEN, 'DENO_DEPLOY_TOKEN is required');
  // CLI accepts personal tokens; the documented REST management API requires
  // an organization token. Keep these independent when both are supplied.
  const token = process.env.DENO_DEPLOY_API_TOKEN ?? process.env.DENO_DEPLOY_TOKEN;
  async function request(method, target, body) {
    const response = await fetch('https://api.deno.com/v2' + target, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    await fs.writeFile(
      path.join(evidence, `${++sequence}-api.json`),
      JSON.stringify({ method, target, status: response.status, text }),
      { mode: 0o600 },
    );
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }
  // Verify REST access before creating anything: CLI personal tokens can list
  // organizations while REST rejects them, leaving no documented CLI deletion.
  assert.equal(
    (await request('GET', '/apps?limit=1')).status,
    200,
    'Organization access token required for immutable-ID cleanup',
  );
  const organizations = JSON.parse(
    await command(binary, ['run', '--no-config', '-A', deployModule, 'orgs', 'list', '--json', '--non-interactive']),
  );
  assert.equal(organizations.length, 1, 'Select one unambiguous accessible test organization');
  const org = organizations[0].slug;
  const apiOrganizations = JSON.parse(
    await command(
      binary,
      ['run', '--no-config', '-A', deployModule, 'orgs', 'list', '--json', '--non-interactive'],
      evidence,
      { DENO_DEPLOY_TOKEN: token },
    ),
  );
  assert.equal(apiOrganizations.length, 1, 'Organization token must select one test organization');
  assert.equal(
    apiOrganizations[0].id,
    organizations[0].id,
    'REST and CLI tokens must select the same organization before creation',
  );
  const slug = `cossack-accept-${randomUUID().slice(0, 12)}`;
  await fs.writeFile(path.join(upload, 'deno.json'), JSON.stringify({ deploy: { org, app: slug, runtime } }, null, 2));
  const validation = JSON.parse(
    await command(binary, [
      'run',
      '--no-config',
      '-A',
      deployModule,
      'create',
      upload,
      '--org',
      org,
      '--app',
      slug,
      '--source',
      'local',
      '--runtime-mode',
      'dynamic',
      '--entrypoint',
      runtime.entrypoint,
      '--region',
      'us',
      '--do-not-use-detected-build-config',
      '--dry-run',
      '--json',
      '--non-interactive',
    ]),
  );
  assert.equal(validation.dryRun, true, 'Validate provider configuration before creation');
  assert.equal((await request('GET', `/apps/${slug}`)).status, 404, 'Test app must not exist before creation');
  let owned;
  let browser;
  try {
    const receipt = await request('POST', '/apps', { slug, config: { runtime } });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.data.slug, slug);
    assert.match(receipt.data.id, /^[0-9a-f-]{36}$/i);
    owned = { id: receipt.data.id, slug };
    await fs.writeFile(path.join(evidence, 'owned.json'), JSON.stringify({ ...owned, org }), { mode: 0o600 });
    const cliIdentity = JSON.parse(
      await command(binary, [
        'run',
        '--no-config',
        '-A',
        deployModule,
        'apps',
        'get',
        '--org',
        org,
        '--app',
        slug,
        '--json',
        '--non-interactive',
      ]),
    );
    assert.equal(cliIdentity.id, owned.id, 'CLI and REST must resolve the same owned application');
    assert.equal(cliIdentity.slug, owned.slug);
    const deployment = JSON.parse(
      await command(binary, [
        'run',
        '--no-config',
        '-A',
        deployModule,
        '--org',
        org,
        '--app',
        slug,
        '--prod',
        '--json',
        '--non-interactive',
        upload,
      ]),
    );
    assert(deployment.revisionId, 'Provider revision receipt required');
    assert(deployment.productionUrl?.startsWith('https://'), 'Provider production URL required');
    const origin = deployment.productionUrl;
    const response = await fetch(origin + '/api/hosted-check', {
      method: 'POST',
      body: 'hosted-request-body',
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.headers.getSetCookie(), ['first=1; Path=/', 'second=2; Path=/']);
    const payload = await response.json();
    assert.match(payload.runtime, /^2\./);
    assert.equal(payload.body, 'hosted-request-body');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    const traffic = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => traffic.push({ url: response.url(), status: response.status() }));
    page.on('requestfailed', (request) => traffic.push({ url: request.url(), failed: request.failure()?.errorText }));
    try {
      for (const route of ['hosted-http', 'hosted-sse', 'hosted-live']) {
        const nativeTransport =
          route === 'hosted-sse'
            ? page
                .waitForResponse((response) => new URL(response.url()).pathname.startsWith('/sse/'), { timeout: 30000 })
                .then((response) => {
                  assert.equal(response.status(), 200);
                  assert(response.headers()['content-type']?.includes('text/event-stream'));
                })
            : route === 'hosted-live'
              ? page
                  .waitForEvent('websocket', {
                    predicate: (socket) => new URL(socket.url()).pathname.startsWith('/ws/page/'),
                    timeout: 30000,
                  })
                  .then(
                    (socket) =>
                      new Promise((resolve, reject) => {
                        const timer = setTimeout(
                          () => reject(new Error('Native hosted WebSocket never received a frame')),
                          30000,
                        );
                        socket.once('framereceived', () => {
                          clearTimeout(timer);
                          resolve();
                        });
                        socket.once('socketerror', (error) => {
                          clearTimeout(timer);
                          reject(new Error(String(error)));
                        });
                      }),
                  )
              : Promise.resolve();
        nativeTransport.catch(() => {});
        assert.equal((await page.goto(origin + '/' + route)).status(), 200);
        await nativeTransport;
        await page.waitForFunction(() => window.__cossackReady === true, null, { timeout: 30000 });
        await expect(page.locator('#count')).toHaveText('0');
        await page.getByRole('button', { name: 'Increment', exact: true }).click();
        await expect(page.locator('#count')).toHaveText('2');
      }
      assert.deepEqual(errors, []);
    } finally {
      await fs.writeFile(path.join(evidence, 'browser.json'), JSON.stringify({ errors, traffic }), { mode: 0o600 });
    }
    await fs.writeFile(
      path.join(evidence, 'hosted-verified.json'),
      JSON.stringify({
        ...owned,
        org,
        revisionId: deployment.revisionId,
        runtime: payload.runtime,
        transports: ['http', 'sse', 'websocket'],
      }),
      { mode: 0o600 },
    );
    return { prepared: true, evidence, upload, hosted: true };
  } finally {
    try {
      await browser?.close();
    } finally {
      if (owned) {
        const current = await request('GET', `/apps/${owned.id}`);
        assert.equal(current.status, 200, 'Read ownership before deletion');
        assert.equal(current.data.id, owned.id);
        assert.equal(current.data.slug, owned.slug);
        assert.equal((await request('DELETE', `/apps/${owned.id}`)).status, 204);
        assert.equal((await request('GET', `/apps/${owned.id}`)).status, 404);
        await fs.writeFile(path.join(evidence, 'cleaned.json'), JSON.stringify(owned), { mode: 0o600 });
      }
    }
  }
}
