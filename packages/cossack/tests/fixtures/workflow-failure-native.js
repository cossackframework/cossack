import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '@cossackframework/scaffold';

const execute = promisify(execFile);
const repository = path.resolve(import.meta.dirname, '../../../..');
export async function prepareWorkflowFixture() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-native-workflow-'));
  try {
    const installed = process.env.COSSACK_WORKFLOWS_INSTALLED_ROOT;
    let root;
    if (installed) {
      await execute(process.execPath, [path.join(installed, 'node_modules/cossack/bin/cossack.js'), 'create', 'app', '--adapter', 'cloudflare', '--preset', 'minimal', '--features', 'workflows', '--yes', '--json'], { cwd: parent, timeout: 30000, env: { ...process.env, COSSACK_DISABLE_UPDATE_CHECK: '1' } });
      root = path.join(parent, 'app');
      await fs.symlink(path.join(installed, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    } else {
      ({ projectDir: root } = await createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', features: ['workflows'], interactive: false }));
      const modules = path.join(root, 'node_modules');
      await fs.mkdir(modules);
      for (const name of await fs.readdir(path.join(repository, 'node_modules'))) {
        if (name.startsWith('.') || name === '@cossackframework') continue;
        await fs.symlink(path.join(repository, 'node_modules', name), path.join(modules, name), 'junction');
      }
      await fs.mkdir(path.join(modules, '@cossackframework'));
      for (const name of ['framework', 'core', 'renderer']) await fs.symlink(path.join(repository, 'packages', name), path.join(modules, '@cossackframework', name), 'junction');
    }
    const configFile = path.join(root, 'wrangler.jsonc');
    const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
    config.d1_databases = [{ binding: 'DB', database_name: 'workflow-native-audit', database_id: '11111111-1111-4111-8111-111111111111' }];
    await fs.writeFile(configFile, JSON.stringify(config));
    await fs.writeFile(path.join(root, 'src/workflows/approval.ts'), `
import {defineWorkflow,type WorkflowContext} from '@cossackframework/core/workflows';
import {input as schema} from '@cossackframework/core/input';
const events={approved:schema.object({approved:schema.boolean()})};
type WorkflowEnv={DB:D1Database};
export const approvalWorkflow=defineWorkflow({name:'approval',version:1,schema:schema.object({reference:schema.string(),mode:schema.enum(['approval','failure'])}),events,
async run(input,{step,env,identity}:WorkflowContext<typeof events,WorkflowEnv>){
const effect=async(kind:string)=>(await env.DB.prepare('INSERT INTO effects(id,kind,n) VALUES (?,?,1) ON CONFLICT(id,kind) DO UPDATE SET n=n+1 RETURNING n').bind(identity.id,kind).first<{n:number}>())!.n;
await step.do('first',async()=>effect('first'));
if(input.mode==='failure'){await step.do('permanent-failure',async()=>{await effect('failure');throw new Error('PRIVATE_NATIVE_WORKFLOW_FAILURE');},{retries:{limit:0,delay:1}});return null;}
await step.do('retried-step',async()=>{const attempts=await effect('attempt');if(attempts===1)throw new Error('PRIVATE_NATIVE_WORKFLOW_RETRY');return attempts;},{retries:{limit:1,delay:10,backoff:'constant'}});
const decision=await step.waitForEvent('approval','approved',{timeout:60000});
await step.do('last',async()=>{await effect('last');await effect(decision.approved?'approved':'rejected');return decision.approved;});
return {approved:decision.approved,reference:input.reference};
}});
`);
    await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/pages/api/workflow.ts'), `
import {createApproval} from '../../workflows/index';
export const POST=async(c:any)=>{const body=await c.req.json();const client=createApproval(c.env);try{
if(body.op==='invoke'){await c.env.DB.exec('CREATE TABLE IF NOT EXISTS effects(id TEXT,kind TEXT,n INTEGER,PRIMARY KEY(id,kind))');return c.json(await client.invoke({reference:'fixture',mode:body.mode??'approval'},{key:body.key,scope:{tenantId:'trusted-fixture',actorId:'fixture-user'}}));}
if(body.op==='inspect')return c.json(await client.inspect(body.identity));
if(body.op==='nativeStatus')return c.json({status:(await (await c.env.WORKFLOWS.get(body.identity.id)).status()).status});
if(body.op==='event'){await client.sendEvent(body.identity,'approved',body.payload);return c.json({ok:true});}
if(body.op==='pause')await client.pause(body.identity);else if(body.op==='resume')await client.resume(body.identity);else if(body.op==='audit')return c.json((await c.env.DB.prepare('SELECT kind,n FROM effects WHERE id=? ORDER BY kind').bind(body.identity.id).all()).results);else return c.json({code:'WORKFLOW_FIXTURE_OPERATION_INVALID'},400);
return c.json({ok:true});
}catch(error){return c.json({code:(error as {code?:string}).code??'WORKFLOW_FIXTURE_FAILED'},400);}};
`);
    const require = createRequire(path.join(root, 'package.json'));
    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    await execute(process.execPath, [vite, 'build'], { cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'production', VITEST: '', CLOUDFLARE_ENV: '', WRANGLER_SEND_METRICS: 'false' } });
    const configPath = path.join(root, 'dist/ssr/wrangler.json');
    const { createTestHarness } = require('wrangler');
    // Wrangler's harness is explicitly ephemeral. Restart acceptance uses a separate native persisted runner.
    return { root, parent, configPath, makeRuntime: () => createTestHarness({ root, workers: [{ configPath }] }) };
  } catch (error) {
    await fs.rm(parent, { recursive: true, force: true });
    throw error;
  }
}
export async function workflowRequest(origin, op, values = {}) {
  const response = await fetch(origin + '/api/workflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...values }), signal: AbortSignal.timeout(10000) });
  const text = await response.text();
  return { status: response.status, value: JSON.parse(text), text };
}
