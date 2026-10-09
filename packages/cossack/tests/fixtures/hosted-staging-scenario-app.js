import fs from 'node:fs/promises';
import path from 'node:path';

/** App-owned acceptance source; no provider resources or credentials are created here. */
export async function authorHostedStagingScenarioApp(appRoot) {
  const write = async (name, source) => {
    const target = path.join(appRoot, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source);
  };
  await write('src/bootstrap/middlewares.ts', `import type {MiddlewareHandler} from 'hono';
import {getCookie} from 'hono/cookie';
const identity:MiddlewareHandler=async(c,next)=>{
 if(c.req.path==='/acceptance'||c.req.path.startsWith('/acceptance/')||c.req.path==='/crpc'){
  const key=(c.env as any).ACCEPTANCE_KEY;
  if(typeof key!=='string'||!key||getCookie(c,'acceptance_actor')!==key)return c.json({code:'COSSACK_AUTH_UNAUTHENTICATED'},401);
  c.set('user' as any,{id:'acceptance-owner'});
 }
 await next();
};
export default [identity];
`);
  await write('src/pages/acceptance/index.ts', `import {Cossack,Page,Server,getRequestContext} from '@cossackframework/core';
import {html} from '@cossackframework/renderer';
@Page({transport:'http'}) export default class Acceptance extends Cossack {
 @Server({authorize:(_value,{context})=>context.get('user')?.id==='acceptance-owner'})
 async edit():Promise<string>{
  await (getRequestContext()!.env as any).DB.prepare("INSERT INTO scenario_effects(actor) VALUES ('acceptance-owner')").run();
  return 'acceptance-saved';
 }
 render(){return html\`<h1>Hosted protected acceptance</h1>\`;}
}
`);
  await write('public/acceptance/private.txt', 'HOSTED_PROTECTED_ASSET_SENTINEL\n');
  await write('src/migrations/hosted-acceptance.ts', `import {sql,type Migration} from '@cossackframework/database';
export default {name:'0001_hosted_acceptance',operations:{up:[sql.unsafe('CREATE TABLE scenario_effects (id INTEGER PRIMARY KEY, actor TEXT NOT NULL)')],down:[{kind:'drop-table',tableName:'scenario_effects'}]}} satisfies Migration;
`);
  await write('orm.config.ts', `import {defineConfig} from '@cossackframework/database';
import {createD1ToolingAdapter} from '@cossackframework/database/tooling';
import migration from './src/migrations/hosted-acceptance';
export default defineConfig({entities:[],migrations:[migration],adapter:context=>createD1ToolingAdapter(context,{binding:'DB'})});
`);
  // Wrap the existing entry rather than reconstructing exports or the app setup.
  const authoredEntry = await fs.readFile(path.join(appRoot, 'src/index.ts'), 'utf8');
  const entry = authoredEntry.includes('const generatedWorker = {')
    ? authoredEntry.split('\nexport default {\n async fetch')[0].replace('const generatedWorker = {', 'export default {')
    : authoredEntry;
  if (!entry.includes('export default {')) throw new Error('Expected generated Worker entry');
  await write('src/index.ts', entry.replace('export default {', 'const generatedWorker = {') + `
export default {
 async fetch(request:Request,env:any,context:any){
  const pathname=new URL(request.url).pathname;
  if(pathname==='/'){
   const row=await env.DB.prepare('SELECT scope, visits FROM cf09_acceptance WHERE id = 1').first();
   if(row?.scope!==env.MODE)return new Response('Binding mismatch',{status:500});
   if(env.MODE==='staging'){
    await env.DB.prepare('SELECT COUNT(*) AS n FROM scenario_effects').first();
    await env.DB.prepare('UPDATE cf09_acceptance SET visits=visits+1 WHERE id=1').run();
   }
   return new Response('Acceptance baseline '+env.MODE);
  }
  if(pathname==='/acceptance/evidence'){
   const cookie=request.headers.get('cookie')??'';
   if(!env.ACCEPTANCE_KEY||!cookie.split(';').some((item:string)=>item.trim()==='acceptance_actor='+encodeURIComponent(env.ACCEPTANCE_KEY)))return Response.json({code:'COSSACK_AUTH_UNAUTHENTICATED'},{status:401});
   const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM scenario_effects').first();
   return Response.json({effects:row.n,scope:env.MODE});
  }
  return generatedWorker.fetch(request,env,context);
 }
};
`);
  const fixtureSource = await fs.readFile(new URL(import.meta.url), 'utf8');
  const scriptSource = fixtureSource.slice(fixtureSource.lastIndexOf('\nasync function acceptanceCI()') + 1);
  await write('scripts/acceptance-ci.mjs', `(${scriptSource})().catch(()=>{console.error('Hosted staging acceptance failed at '+String(process.env.COSSACK_ACCEPTANCE_PHASE??'unknown')+'; diagnostics are withheld to protect credentials.');process.exitCode=1;});\n`);
  return { migrationReceipt: '.cossack/scenario-migration.json', smokeReceipt: '.cossack/scenario-smoke.json', script: 'scripts/acceptance-ci.mjs' };
}

// This function is serialized into the generated app; imports stay app-local.
async function acceptanceCI() {
  const { default: fs } = await import('node:fs/promises');
  const { default: assert } = await import('node:assert/strict');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execute = promisify(execFile);
  const write = async (name, receipt) => {
    await fs.mkdir('.cossack', { recursive: true });
    await fs.writeFile('.cossack/' + name, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  };
  const command = async args => {
    process.env.COSSACK_ACCEPTANCE_PHASE=args.slice(0,2).join('-');
    const { stdout } = await execute('pnpm', ['exec', 'cossack', ...args, '--json'], { timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    return result.data;
  };
  if (process.argv[2] === 'migrate') {
    const accountId = process.env.COSSACK_ACCEPTANCE_ACCOUNT_ID;
    const databaseId = process.env.COSSACK_ACCEPTANCE_STAGING_DATABASE_ID;
    assert.ok(accountId && databaseId);
    const plan = await command(['migration', 'plan', '--remote', '--env', 'staging']);
    assert.equal(plan.complete, true);
    assert.equal(plan.migrations.length, 1);
    const migration = plan.migrations[0];
    const target = migration.target;
    for (const [key, value] of Object.entries({ provider: 'd1', target: 'remote', environment: 'staging', binding: 'DB', accountId, databaseId })) assert.equal(target[key], value);
    assert.equal(migration.complete, true);
    assert.equal(migration.name, '0001_hosted_acceptance');
    assert.equal(migration.direction, 'up');
    assert.equal(migration.statements.length, 1);
    assert.ok(migration.statements[0].text.includes('CREATE TABLE scenario_effects'));
    assert.equal(migration.statements[0].parameterCount, 0);
    const applied = await command(['migration', 'up', '--remote', '--env', 'staging']);
    assert.deepEqual(applied.applied, [migration.name]);
    const status = await command(['migration', 'status', '--remote', '--env', 'staging']);
    assert.equal(status.migrations.length, 1);
    assert.equal(status.migrations[0].state, 'applied');
    assert.equal(status.migrations[0].applied.checksum, migration.checksum);
    const remaining = await command(['migration', 'plan', '--remote', '--env', 'staging']);
    assert.equal(remaining.migrations.length, 0);
    const verification = { historyChecksum: status.migrations[0].applied.checksum, pendingAfter: 0 };
    const deployed = await command(['deploy', '--dry-run', '--env', 'staging']);
    const artifact = JSON.parse(await fs.readFile(deployed.artifact, 'utf8'));
    assert.equal(artifact.account_id, accountId);
    assert.equal(artifact.d1_databases.find(value => value.binding === 'DB')?.database_id, databaseId);
    assert.equal(artifact.vars.MODE, 'staging');
    await write('scenario-migration.json', { schemaVersion: 1, plan: { target, name: migration.name, checksum: migration.checksum, statements: migration.statements }, applied: true, appliedNames: applied.applied, verification, artifact: { accountId, databaseId, configPath: deployed.artifact, environment: 'staging' } });
  } else if (process.argv[2] === 'smoke') {
    process.env.COSSACK_ACCEPTANCE_PHASE='smoke-journal';
    const journal = JSON.parse(await fs.readFile(process.env.COSSACK_ACCEPTANCE_PREVIEW_JOURNAL, 'utf8'));
    assert.equal(journal.status, 'deployed');
    const origin = new URL(journal.url).origin;
    const secrets = JSON.parse(process.env.COSSACK_PREVIEW_SECRETS_JSON);
    assert.ok(typeof secrets.ACCEPTANCE_KEY === 'string' && secrets.ACCEPTANCE_KEY);
    const headers = { cookie: 'acceptance_actor=' + encodeURIComponent(secrets.ACCEPTANCE_KEY), origin };
    const request = (pathname, options = {}) => {process.env.COSSACK_ACCEPTANCE_PHASE='smoke-'+pathname;return fetch(new URL(pathname, origin), { ...options, signal: AbortSignal.timeout(30000) });};
    const counts = async () => {
      const response = await request('/acceptance/evidence', { headers });
      assert.equal(response.status, 200);
      const body = await response.json(); assert.equal(body.scope, 'staging'); return body.effects;
    };
    const before = await counts(); assert.equal(before, 0);
    const anonymousAsset = await request('/acceptance/private.txt');
    assert.equal(anonymousAsset.status, 401); await anonymousAsset.body?.cancel();
    const authorizedAsset = await request('/acceptance/private.txt', { headers });
    assert.equal(authorizedAsset.status, 200);
    assert.equal((await authorizedAsset.text()).trim(), 'HOSTED_PROTECTED_ASSET_SENTINEL');
    const page = await request('/acceptance', { headers }); assert.equal(page.status, 200);
    const html = await page.text();
    const match = html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);?\s*<\/script>/);
    assert.ok(match, 'Expected actual Cossack hydration');
    const state = JSON.parse(match[1]);
    assert.ok(state.componentRouteId && state.scopeKey);
    const envelope = { componentRouteId: state.componentRouteId, scopeKey: state.scopeKey, action: 'edit', payload: [], state: { user: { id: 'acceptance-owner' }, permissions: { edit: true } } };
    const anonymousRpc = await request('/crpc', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
    assert.equal(anonymousRpc.status, 401); assert.equal((await anonymousRpc.json()).code, 'COSSACK_AUTH_UNAUTHENTICATED');
    const anonymousAfter = await counts(); assert.equal(anonymousAfter, before);
    const authorizedRpc = await request('/crpc', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
    assert.equal(authorizedRpc.status, 200); assert.equal((await authorizedRpc.json())._cossack_return, 'acceptance-saved');
    const after = await counts(); assert.equal(after, before + 1);
    await write('scenario-smoke.json', { schemaVersion: 1, url: journal.url, protectedAsset: { anonymousStatus: 401, authorizedStatus: 200, markerVerified: true }, rpc: { anonymousStatus: 401, authorizedStatus: 200, effectsBefore: before, anonymousEffectsAfter: anonymousAfter, effectsAfter: after, returnVerified: true }, stagingRows: { before, after }, identity: 'server-owned-synthetic-cookie' });
  } else throw new Error('Expected migrate or smoke mode');
}
