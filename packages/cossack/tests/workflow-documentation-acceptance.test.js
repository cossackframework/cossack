import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createApp } from '@cossackframework/scaffold';
const execute = promisify(execFile);
const repository = path.resolve(import.meta.dirname, '../../..');

it('strictly compiles the unchanged Workflow guide examples against public generated application types', async () => {
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-workflow-guide-'));
 const installed=process.env.COSSACK_WORKFLOWS_INSTALLED_ROOT;
 try {
  let root;
  if(installed) {
   root=path.join(parent,'app');
   await execute(process.execPath,[path.join(installed,'node_modules/cossack/bin/cossack.js'),'create','app','--adapter=cloudflare','--preset=minimal','--features=workflows','--yes','--json'],{cwd:parent,timeout:30000,env:{...process.env,COSSACK_DISABLE_UPDATE_CHECK:'1'}});
   await fs.symlink(path.join(installed,'node_modules'),path.join(root,'node_modules'),'junction');
  } else {
   ({projectDir:root}=await createApp('app',{cwd:parent,adapter:'cloudflare',preset:'minimal',features:['workflows'],interactive:false}));
   await fs.mkdir(path.join(root,'node_modules/@cossackframework'),{recursive:true});
   for(const name of await fs.readdir(path.join(repository,'node_modules'))) {
    if(name.startsWith('.')||name==='@cossackframework')continue;
    await fs.symlink(path.join(repository,'node_modules',name),path.join(root,'node_modules',name),'junction');
   }
   for(const name of ['core','renderer','framework','scaffold'])await fs.symlink(path.join(repository,'packages',name),path.join(root,'node_modules/@cossackframework',name),'junction');
  }
  const markdown=await fs.readFile(path.join(repository,'docs/workflows.md'),'utf8');
  const snippets=[...markdown.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map(match=>match[1]);
  expect(snippets).toHaveLength(4);
  const files=['src/workflows/approval.ts','src/workflows/entry.ts','src/workflows/index.ts','src/handlers/approval.ts'];
  for(let index=0;index<files.length;index++) {
   const filename=path.join(root,files[index]);await fs.mkdir(path.dirname(filename),{recursive:true});
   await fs.writeFile(filename,snippets[index]);expect(await fs.readFile(filename,'utf8')).toBe(snippets[index]);
  }
  // Application-owned contract fixtures only: this test does not implement receipt transactions or authentication.
  await fs.writeFile(path.join(root,'src/workflows/operations.ts'),`export async function prepareRecord(env: Env, reference: string, workflowId: string): Promise<void> { void [env,reference,workflowId]; }
export async function finishRecord(env: Env, reference: string, approved: boolean, workflowId: string): Promise<void> { void [env,reference,approved,workflowId]; }
`);
  await fs.mkdir(path.join(root,'src/auth'),{recursive:true});
  await fs.writeFile(path.join(root,'src/auth/authorize-workflow.ts'),`import type { WorkflowIdentity } from '@cossackframework/core/workflows';
export async function authorizeRecordWorkflow(operation: 'invoke'|'inspect'|'event'|'pause'|'resume'|'terminate', identity: WorkflowIdentity): Promise<void> { void [operation,identity]; }
`);
  await fs.writeFile(path.join(root,'workflow-guide-context.d.ts'),`interface Env extends CloudflareBindings {}
declare const env: Env;
declare const trustedTenantId: string;
declare const trustedUserId: string;
`);
  await fs.writeFile(path.join(root,'src/workflows/guide-negative.ts'),`import { createApproval } from './index';
declare const environment: Env;
const client=createApproval(environment);
// @ts-expect-error Authored input reference is a string.
client.invoke({reference:123},{key:'guide',scope:{tenantId:'tenant',actorId:'actor'}});
async function eventChecks() {
const identity=await client.invoke({reference:'guide'},{key:'guide',scope:{tenantId:'tenant',actorId:'actor'}});
// @ts-expect-error Event payload approved is boolean.
await client.sendEvent(identity,'approved',{approved:'yes'});
// @ts-expect-error Events retain their declared discriminator.
await client.sendEvent(identity,'undeclared',{approved:true});
}
void eventChecks;
`);
  const require=createRequire(path.join(root,'package.json'));
  const wrangler=path.join(path.dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
  await execute(process.execPath,[wrangler,'types','--env-interface','CloudflareBindings'],{cwd:root,timeout:30000,maxBuffer:1024*1024,env:{...process.env,CLOUDFLARE_ENV:'',CLOUDFLARE_CF_FETCH_ENABLED:'false',WRANGLER_SEND_METRICS:'false',WRANGLER_HIDE_BANNER:'true',WRANGLER_LOG_PATH:path.join(parent,'wrangler.log')}});
  const compiler=path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc');
  await fs.writeFile(path.join(root,'tsconfig.workflow-guide.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,target:'ES2022',module:'ESNext',moduleResolution:'Bundler',skipLibCheck:true,experimentalDecorators:true,types:[],lib:['ES2022','DOM']},files:[...files,'src/workflows/operations.ts','src/auth/authorize-workflow.ts','src/workflows/guide-negative.ts','workflow-guide-context.d.ts','worker-configuration.d.ts']}));
  try {await execute(process.execPath,[compiler,'--project','tsconfig.workflow-guide.json'],{cwd:root,timeout:30000,maxBuffer:1024*1024});}
  catch(error) {throw new Error(error.stdout+'\n'+error.stderr);}
  // Extensionless authored guide modules use Bundler resolution; this separate consumer checks package export declarations in NodeNext.
  await fs.writeFile(path.join(root,'workflow-public-contract.mts'),`import { input } from '@cossackframework/core/input';
import { defineWorkflow, createWorkflowClient, type WorkflowContext } from '@cossackframework/core/workflows';
import { createCloudflareWorkflow } from '@cossackframework/framework/workflows';
import { createCloudflareWorkflowProvider, type CloudflareWorkflowBinding } from '@cossackframework/framework/workflows/provider';
const events={approved:input.object({approved:input.boolean()})};
const definition=defineWorkflow({name:'public-contract',version:1,schema:input.object({reference:input.string()}),events,
async run(payload, context:WorkflowContext<typeof events,{WORKFLOWS:CloudflareWorkflowBinding}>) { void payload; return context.step.waitForEvent('approval','approved',{timeout:1000}); }});
const NativeEntry=createCloudflareWorkflow(definition); void NativeEntry;
declare const binding:CloudflareWorkflowBinding;
const client=createWorkflowClient(definition,createCloudflareWorkflowProvider(binding),{namespace:'public-contract'}); void client;
`);
  await fs.writeFile(path.join(root,'tsconfig.workflow-public.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',skipLibCheck:true,types:[],lib:['ES2022','DOM']},files:['workflow-public-contract.mts','worker-configuration.d.ts']}));
  try {await execute(process.execPath,[compiler,'--project','tsconfig.workflow-public.json'],{cwd:root,timeout:30000,maxBuffer:1024*1024});}
  catch(error) {throw new Error(error.stdout+'\n'+error.stderr);}

 } finally {await fs.rm(parent,{recursive:true,force:true});}
},100000);
