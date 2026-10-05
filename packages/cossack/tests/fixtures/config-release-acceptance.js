import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { chromium, expect as browserExpect } from '@playwright/test';

export const CONFIG_RELEASE_MARKERS = [
  'RT24_ALPHA_PRIVATE_TOKEN_SENTINEL', 'RT24_BETA_PRIVATE_TOKEN_SENTINEL',
  'RT24_PRIVATE_FACTORY_SOURCE_SENTINEL', 'RT24_INVALID_PRIVATE_VALUE_SENTINEL',
];
const absent = (text, location) => {
  for (const marker of CONFIG_RELEASE_MARKERS) assert.ok(!text.includes(marker), `Private config leaked into ${location}`);
};
export async function writeConfigReleaseAcceptance(root) {
  const write = async (file, source) => {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, source);
  };
  await write('src/config/release_private.ts', `
import {requireConfigVariable, type ConfigRequirements, type EnvFunction} from '@cossackframework/framework/config';
export const requirements={variables:{
  RT24_PRIVATE_TOKEN:{type:'string',secret:true,runtimes:['node','deno']},
  RT24_PROFILE:{type:'string',runtimes:['node','deno']},
  RT24_LIMIT:{type:'number',coerce:true,runtimes:['node','deno']},
  RT24_FLAG:{type:'boolean',coerce:true,runtimes:['node','deno']}
},bindings:{RT24_BINDING:{kind:'object',runtimes:['node','deno']}}} as const satisfies ConfigRequirements;
export default ({env}:{env:EnvFunction})=>{
  (globalThis as any).__rt24FactoryCount=((globalThis as any).__rt24FactoryCount??0)+1;
  return {token:env('RT24_PRIVATE_TOKEN'),source:'${CONFIG_RELEASE_MARKERS[2]}',
    profile:requireConfigVariable('RT24_PROFILE','string'),limit:requireConfigVariable('RT24_LIMIT','number'),
    flag:requireConfigVariable('RT24_FLAG','boolean')};
};
`);
  await write('src/pages/config-release/index.ts', `
import {Cossack,Page,State,Server} from '@cossackframework/core';
import {html} from '@cossackframework/renderer';
import {config,requireConfigVariable} from '@cossackframework/framework/config';
@Page({transport:'http'})export default class ConfigReleasePage extends Cossack {
  @State()ready=false;@State()profile='';@State()limit=0;@State()flag=false;@State()count=0;
  private token='';private source='';
  async init(){
    (globalThis as any).__rt24PageCount=((globalThis as any).__rt24PageCount??0)+1;
    const before=config('release_private.profile');this.token=requireConfigVariable('RT24_PRIVATE_TOKEN','string');
    this.source=config('release_private.source');await new Promise(resolve=>setTimeout(resolve,30));
    this.profile=config('release_private.profile');this.limit=config('release_private.limit');this.flag=config('release_private.flag');
    this.ready=before===this.profile&&config('release_private.token')===this.token&&this.token.length>0&&this.source.length>0;
  }
  @Server()async increment(){
    const profile=config('release_private.profile');const token=requireConfigVariable('RT24_PRIVATE_TOKEN','string');
    await new Promise(resolve=>setTimeout(resolve,30));
    if(profile!==config('release_private.profile')||token!==config('release_private.token'))throw Error('Config scope mismatch');
    this.count++;return {profile,limit:config('release_private.limit'),flag:config('release_private.flag')};
  }
  render(){return html\`<main><span id="config-ready">\${this.ready?'ready':'missing'}</span><span id="config-profile">\${this.profile}</span><span id="config-count">\${this.count}</span><button @click=\${()=>this.increment()}>Increment config count</button></main>\`;}
}
`);
}

/** Exercise the generated application through its real native adapter. */
export async function startConfigReleaseServer(root, runtime, binary = process.env.COSSACK_DENO_BINARY ?? 'deno') {
  const profiles = {
    alpha: { RT24_PROFILE: 'alpha', RT24_PRIVATE_TOKEN: CONFIG_RELEASE_MARKERS[0], RT24_LIMIT: '7', RT24_FLAG: 'true' },
    beta: { RT24_PROFILE: 'beta', RT24_PRIVATE_TOKEN: CONFIG_RELEASE_MARKERS[1], RT24_LIMIT: '19', RT24_FLAG: 'false' },
  };
  const common = `
    const {app,env,runtime}=await import('./dist/server/index.js');
    const profiles=${JSON.stringify(profiles)};
    const dispatch=async request=>{
      const selection=request.headers.get('x-fixture-profile')??'alpha';
      const selected=selection==='beta'?profiles.beta:profiles.alpha;
      const bindings={...env,...selected,RT24_BINDING:{fixture:true}};
      if(selection==='missing')delete bindings.RT24_PRIVATE_TOKEN;
      if(selection==='invalid')bindings.RT24_LIMIT=${JSON.stringify(CONFIG_RELEASE_MARKERS[3])};
      if(selection==='missing-binding')delete bindings.RT24_BINDING;
      if(selection==='invalid-binding')bindings.RT24_BINDING='not-an-object';
      const response=await ${runtime === 'deno' ? 'runtime.fetch(app,request,bindings)' : 'app.fetch(request,bindings)'};
      const headers=new Headers(response.headers);
      headers.set('x-fixture-factory-count',String(globalThis.__rt24FactoryCount??0));
      headers.set('x-fixture-page-count',String(globalThis.__rt24PageCount??0));
      return new Response(response.body,{status:response.status,headers});
    };
  `;
  const source = runtime === 'deno' ? common + `
    const server=Deno.serve({hostname:'127.0.0.1',port:0,onListen:({port})=>{env.APP_URL='http://127.0.0.1:'+port;console.log('CONFIG_RELEASE_ORIGIN='+env.APP_URL);}},dispatch);
    Deno.addSignalListener('SIGTERM',async()=>{await runtime.dispose();await server.shutdown();});
  ` : common + `
    const {serve}=await import('@hono/node-server');
    const server=serve({fetch:dispatch,hostname:'127.0.0.1',port:0},()=>{
      env.APP_URL='http://127.0.0.1:'+server.address().port;
      console.log('CONFIG_RELEASE_ORIGIN='+env.APP_URL);
    });
    runtime.attach(server,dispatch);
    process.once('SIGTERM',async()=>{await runtime.dispose();server.close(()=>process.exit(0));});
  `;
  const child = spawn(runtime === 'deno' ? binary : process.execPath,
    runtime === 'deno' ? ['eval', '--ext=js', source] : ['--input-type=module', '-e', source],
    { cwd: root, env: { ...process.env, NODE_ENV: 'production', VITEST: '', APP_URL: 'http://localhost', PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit'); exited.catch(() => {});
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try { const [code, signal] = await exited; assert.equal(code, 0, `Native config server failed (${signal ?? 'exit'})`); }
    finally { clearTimeout(timer); }
  };
  try {
    await browserExpect.poll(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw Error('Native config server exited before readiness');
      return /CONFIG_RELEASE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    }, { timeout: 30000 }).toBeTruthy();
    return { origin: /CONFIG_RELEASE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1], close, diagnostics: () => output };
  } catch (error) { await close(); absent(output, 'startup diagnostics'); throw new Error(`${error.message}\n${output}`); }
}

export async function checkConfigReleaseAcceptance(root, server) {
  const request = (profile, route = '/config-release', init = {}) => fetch(server.origin + route,
    { ...init, headers: { ...init.headers, 'x-fixture-profile': profile } });
  const hydration = html => {
    const match = html.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s);
    assert.ok(match, 'Native SSR must emit hydration state'); return JSON.parse(match[1]);
  };
  const replies = await Promise.all(['alpha', 'beta'].map(async profile => {
    const response = await request(profile); assert.equal(response.status, 200);
    const html = await response.text(); absent(html, 'native SSR HTML');
    const state = hydration(html); absent(JSON.stringify(state), 'native hydration state');
    assert.deepEqual({ ready: state.public.ready, profile: state.public.profile, limit: state.public.limit, flag: state.public.flag },
      { ready: true, profile, limit: profile === 'alpha' ? 7 : 19, flag: profile === 'alpha' });
    assert.ok(!Object.hasOwn(state.public, 'token')); assert.ok(!Object.hasOwn(state.public, 'source'));
    return { state, factoryCount: response.headers.get('x-fixture-factory-count'), pageCount: response.headers.get('x-fixture-page-count') };
  }));
  const latest = await request('alpha'); await latest.arrayBuffer();
  const before = { factory: latest.headers.get('x-fixture-factory-count'), page: latest.headers.get('x-fixture-page-count') };
  for (const [profile, name, code] of [
    ['missing', 'RT24_PRIVATE_TOKEN', 'COSSACK_CONFIG_REQUIRED_MISSING'],
    ['invalid', 'RT24_LIMIT', 'COSSACK_CONFIG_VARIABLE_INVALID'],
    ['missing-binding', 'RT24_BINDING', 'COSSACK_CONFIG_REQUIRED_MISSING'],
    ['invalid-binding', 'RT24_BINDING', 'COSSACK_CONFIG_BINDING_INVALID'],
  ]) {
    const response = await request(profile); assert.equal(response.status, 500);
    const failure = await response.text(); absent(failure, 'native runtime failure response');
    assert.equal(JSON.parse(failure).code, 'COSSACK_REQUEST_INTERNAL');
    assert.ok(!failure.includes(name), 'Requirement names belong in server diagnostics, not public failures');
    assert.equal(response.headers.get('x-fixture-factory-count'), before.factory, 'Invalid config must stop before factory use');
    assert.equal(response.headers.get('x-fixture-page-count'), before.page, 'Invalid config must stop before page lifecycle');
    await browserExpect.poll(() => server.diagnostics().includes(name) && server.diagnostics().includes(code), { timeout: 5000 }).toBe(true);
    const output = server.diagnostics(); absent(output, 'native runtime diagnostics');
    assert.ok(output.includes('cossack.config.requirement.failed'), 'Capture the config failure event');
    assert.ok(output.includes('requirementName'), 'Requirement identity must be an explicit diagnostic field');
  }
  await Promise.all(replies.map(async ({ state }, index) => {
    const profile = ['alpha', 'beta'][index];
    const body = JSON.stringify({ componentRouteId: state.componentRouteId, action: 'increment', payload: [], state: state.public });
    absent(body, 'native RPC request');
    const response = await request(profile, '/crpc', { method: 'POST', headers: { 'content-type': 'application/json', origin: server.origin }, body });
    const text = await response.text(); absent(text, 'native RPC response'); assert.equal(response.status, 200, text);
    const result = JSON.parse(text)._cossack_return;
    assert.deepEqual(result, { profile, limit: profile === 'alpha' ? 7 : 19, flag: profile === 'alpha' });
  }));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors = [], bodies = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (new URL(req.url()).pathname === '/crpc') requests.push(req.postData() ?? ''); });
    page.on('response', response => {
      if (response.request().resourceType() === 'script' || new URL(response.url()).pathname === '/crpc') bodies.push(response.text());
    });
    await page.goto(server.origin + '/config-release'); await page.waitForFunction(() => window.__cossackReady === true);
    await browserExpect(page.locator('#config-ready')).toHaveText('ready');
    await browserExpect(page.locator('#config-profile')).toHaveText('alpha');
    await page.getByRole('button', { name: 'Increment config count', exact: true }).click();
    await browserExpect(page.locator('#config-count')).toHaveText('1');
    assert.ok(requests.length > 0, 'Browser button must invoke native RPC');
    requests.forEach(text => absent(text, 'browser RPC request'));
    const delivered = await Promise.all(bodies); assert.ok(delivered.length > 0, 'Capture real delivered JavaScript');
    delivered.forEach(text => absent(text, 'browser delivered JavaScript/RPC response'));
    assert.deepEqual(errors, []); absent(JSON.stringify(await page.evaluate(() => window.__INITIAL_STATE__)), 'browser hydration');
  } finally { await browser.close(); }
  let scripts = 0, maps = 0;
  const scan = async directory => { for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (/\.(?:js|map)$/.test(entry.name)) {
      if (entry.name.endsWith('.map')) maps++; else scripts++;
      const text = await fs.readFile(file, 'utf8'); absent(text, 'production client asset/map');
      assert.ok(!text.includes('RT24_PRIVATE_TOKEN'), 'Private requirement metadata entered the client bundle');
    }
  } };
  await scan(path.join(root, 'dist/client')); assert.ok(scripts > 0 && maps > 0, 'Scan actual scripts and source maps');
  absent(server.diagnostics(), 'native process logs');
}

/** Static metadata inspection never executes factories or reads local environment files. */
export async function checkConfigReleaseTooling(root, cliFile) {
  const run = promisify(execFile);
  const inspect = await run(process.execPath, [cliFile, 'config', '--json'], { cwd: root, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  absent(inspect.stdout + inspect.stderr, 'configuration catalog');
  const catalog = JSON.parse(inspect.stdout); assert.equal(catalog.ok, true);
  assert.equal(catalog.data.evaluation, 'not-performed'); assert.equal(catalog.data.validation, 'not-performed');
  assert.ok(catalog.data.factories.some(factory => factory.key === 'release_private' && factory.requirements.variables.RT24_PRIVATE_TOKEN.secret === true));
  const checked = await run(process.execPath, [cliFile, 'config', '--check', '--json'], { cwd: root, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }).catch(error => error);
  absent(checked.stdout + checked.stderr, 'declaration diagnostics');
  const envelope = JSON.parse(checked.stdout);
  assert.equal(envelope.ok, false); assert.ok(envelope.diagnostics.some(diagnostic => diagnostic.code === 'COSSACK_CONFIG_CHECK_UNAVAILABLE'));
  await run(process.execPath, [cliFile, 'config', '--generate', '--json'], { cwd: root, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const typecheck = path.join(root, 'src/config-release-types.ts');
  await fs.writeFile(typecheck, `import {config} from '@cossackframework/framework/config';\nconst valid:number=config('release_private.limit');\n// @ts-expect-error unknown configured path\nconfig('release_private.misspelled');\n// @ts-expect-error incorrect inferred scalar fallback\nconfig('release_private.limit','wrong');\nvoid valid;\n`);
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    await run(process.execPath, [compiler, '--noEmit'], { cwd: root, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  } finally { await fs.rm(typecheck, { force: true }); }
}
