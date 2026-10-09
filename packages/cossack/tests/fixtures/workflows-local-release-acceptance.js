import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';

// Independent tracked fixture derived from the existing approval acceptance shape.
// Local evidence uses persisted effects; hosted acceptance owns literal Waiting.

export async function writeLocalWorkflowsAcceptance(root) {
 const write=async(name,source)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,source);};
 const configFile=path.join(root,'wrangler.jsonc');const config=JSON.parse(await fs.readFile(configFile,'utf8'));config.d1_databases=[{binding:'DB',database_name:'workflow-fixture',database_id:'11111111-1111-4111-8111-111111111111'}];await fs.writeFile(configFile,JSON.stringify(config));
 await write('src/workflows/approval.ts',`
 import {defineWorkflow,type WorkflowContext} from '@cossackframework/core/workflows';
 import {input as schema} from '@cossackframework/core/input';
 const events={approved:schema.object({approved:schema.boolean()})};
 type WorkflowEnv={DB:D1Database};
 export const approvalWorkflow=defineWorkflow({name:'approval',version:1,schema:schema.object({reference:schema.string(),mode:schema.enum(['approval','failure'])}),events,
 async run(input,{step,env,identity}:WorkflowContext<typeof events,WorkflowEnv>){
 const effect=async(kind:string)=>(await env.DB.prepare('INSERT INTO effects(id,kind,n) VALUES (?,?,1) ON CONFLICT(id,kind) DO UPDATE SET n=n+1 RETURNING n').bind(identity.id,kind).first<{n:number}>())!.n;
 await step.do('first',async()=>effect('first'));
 if(input.mode==='failure'){await step.do('permanent-failure',async()=>{throw new Error('PRIVATE_WORKFLOW_FAILURE_SENTINEL');},{retries:{limit:0,delay:1}});return null;}
 await step.do('retried-step',async()=>{const attempts=await effect('attempt');if(attempts===1)throw new Error('PRIVATE_RETRIED_WORKFLOW_SENTINEL');return attempts;},{retries:{limit:1,delay:10,backoff:'constant'}});
 const decision=await step.waitForEvent('approval','approved',{timeout:180000});
 await step.do('last',async()=>{await effect('last');return decision.approved;});return {approved:decision.approved,reference:input.reference};
 }});
 `);
 await write('src/workflows/public-types-proof.ts',`
 import {createApproval} from './index';
 import type {WorkflowIdentity,WorkflowInspection} from '@cossackframework/core/workflows';
 export async function proof(env:Env){const client=createApproval(env);const identity:WorkflowIdentity=await client.invoke({reference:'one',mode:'approval'},{key:'one',scope:{tenantId:'tenant',actorId:'actor'}});await client.sendEvent(identity,'approved',{approved:true});const inspected:WorkflowInspection=await client.inspect(identity);await client.pause(identity);await client.resume(identity);await client.terminate(identity);
 // @ts-expect-error invalid workflow input mode
 await client.invoke({reference:'one',mode:'invalid'},{key:'two'});
 // @ts-expect-error undeclared event name
 await client.sendEvent(identity,'missing',{approved:true});
 // @ts-expect-error event payload is schema typed
 await client.sendEvent(identity,'approved',{approved:'wrong'});
 // @ts-expect-error private payload is absent from inspection
 inspected.payload;
 // @ts-expect-error provider output is absent from inspection
 inspected.output;
 return inspected;}
 `);
 await write('src/pages/api/workflow.ts',`
 import {createApproval} from '../../workflows/index';
 export const POST=async(c:any)=>{const body=await c.req.json();const client=createApproval(c.env);try{
 if(body.op==='invoke'){await c.env.DB.exec('CREATE TABLE IF NOT EXISTS effects(id TEXT,kind TEXT,n INTEGER,PRIMARY KEY(id,kind))');return c.json(await client.invoke({reference:'fixture',mode:body.mode??'approval'},{key:body.key,scope:{tenantId:'trusted-fixture',actorId:'fixture-user'}}));}
 if(body.op==='inspect')return c.json(await client.inspect(body.identity));
 if(body.op==='event'){await client.sendEvent(body.identity,'approved',body.payload);return c.json({ok:true});}
 if(body.op==='pause')await client.pause(body.identity);else if(body.op==='resume')await client.resume(body.identity);else if(body.op==='terminate')await client.terminate(body.identity);else if(body.op==='audit')return c.json((await c.env.DB.prepare('SELECT kind,n FROM effects WHERE id=? ORDER BY kind').bind(body.identity.id).all()).results);
 return c.json({ok:true});
 }catch(error){return c.json({code:(error as {code?:string}).code??'WORKFLOW_FIXTURE_FAILED'},400);}};
 `);
}
export async function checkLocalWorkflowsAcceptance(makeRuntime) {
 let runtime;
 let origin;
 const nativeStatuses = [];
 const open = async () => {
  runtime = await makeRuntime();
  origin = new URL((await runtime.listen()).url).origin;
 };
 const call = async (op, values = {}) => {
  const response = await fetch(origin + '/api/workflow', {
   method: 'POST', headers: {'Content-Type': 'application/json'},
   body: JSON.stringify({op, ...values}), signal: AbortSignal.timeout(10000),
  });
  return {status: response.status, value: await response.json()};
 };
 const effects = async (identity) => {
  const response = await call('audit', {identity});
  expect(response.status).toBe(200);
  return response.value;
 };
 const inspect = async (identity) => {
  const response = await call('inspect', {identity});
  expect(response.status).toBe(200);
  return response.value;
 };
 const before = [{kind:'attempt', n:2}, {kind:'first', n:1}];
 try {
  await open();
  const invoked = await call('invoke', {key:'approval-one'});
  expect(invoked.status).toBe(200);
  const identity = invoked.value;
  expect(identity).toMatchObject({name:'approval', version:1, scope:{tenantId:'trusted-fixture', actorId:'fixture-user'}});
  // The retry's durable effects prove readiness. No synthetic provider status.
  await expect.poll(() => effects(identity), {timeout:30000}).toEqual(before);
  nativeStatuses.push((await inspect(identity)).status);
  const repeated = await call('invoke', {key:'approval-one'});
  expect(repeated.status).toBe(200);
  expect(repeated.value).toEqual(identity);
  expect(await effects(identity)).toEqual(before);
  expect((await call('pause', {identity})).status).toBe(200);
  await expect.poll(async () => (await inspect(identity)).status, {timeout:10000}).toBe('paused');
  await runtime.close();
  runtime = undefined;
  await open();
  expect((await inspect(identity)).status).toBe('paused');
  expect(await effects(identity)).toEqual(before);
  expect((await call('resume', {identity})).status).toBe(200);
  await expect.poll(async () => ['running','waiting'].includes((await inspect(identity)).status), {timeout:10000}).toBe(true);
  nativeStatuses.push((await inspect(identity)).status);
  expect(await effects(identity)).toEqual(before);
  expect(await call('event', {identity, payload:{approved:'PRIVATE_BAD_VALUE'}})).toEqual({status:400, value:{code:'WORKFLOW_EVENT_INVALID'}});
  expect(await effects(identity)).toEqual(before);
  expect(['running','waiting']).toContain((await inspect(identity)).status);
  expect((await call('event', {identity, payload:{approved:true}})).status).toBe(200);
  await expect.poll(async () => (await inspect(identity)).status, {timeout:30000}).toBe('complete');
  expect(await effects(identity)).toEqual([...before, {kind:'last', n:1}]);
  const failed = await call('invoke', {key:'failed-one', mode:'failure'});
  expect(failed.status).toBe(200);
  await expect.poll(async () => (await inspect(failed.value)).status, {timeout:30000}).toBe('failed');
  const inspected = await inspect(failed.value);
  expect(inspected.code).toBe('WORKFLOW_FAILED');
  expect(JSON.stringify(inspected)).not.toMatch(/PRIVATE_|payload|output|message/);
  expect(await effects(failed.value)).toEqual([{kind:'first', n:1}]);
  return {nativeStatuses, retryAttempts:2, firstEffects:1, lastEffects:1, restarted:true, failedInspectionRedacted:true};
 } finally {
  if (runtime) await runtime.close();
 }
}
