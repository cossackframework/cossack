import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';

export async function writeApiContractAcceptance(root) {
  const write = async (file, source) => {
    const absolute = path.join(root, file); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, source);
  };
  await write('src/pages/(contracts)/api/declared/[id].ts', `
    import {input} from '@cossackframework/core'; import {defineApi as endpoint} from '@cossackframework/framework/api';
    import type {Context} from 'hono';
    // The Node fixture checks one process. The Worker fixture uses D1 for mutation evidence.
    let localRuns=0;
    async function audit(c:Context, increment=false) {
      if(c.env.DB) {
        await c.env.DB.prepare('CREATE TABLE IF NOT EXISTS native_api_audit (id INTEGER PRIMARY KEY AUTOINCREMENT)').run();
        if(increment)await c.env.DB.prepare('INSERT INTO native_api_audit DEFAULT VALUES').run();
        return Number((await c.env.DB.prepare('SELECT count(*) AS count FROM native_api_audit').first()).count);
      }
      if(increment)localRuns++;return localRuns;
    }
    const body=input.object({amount:input.number({min:1})}).refine(value=>value.amount!==99,'PRIVATE_API_REFINEMENT_SENTINEL');
    export const POST=endpoint({
      input:{params:input.object({id:input.string()}),query:input.object({page:input.number({coerce:true,min:1}),tags:input.array(input.string())}),body},
      queryArrays:['tags'], output:input.object({id:input.string(),total:input.number(),tags:input.array(input.string()),runs:input.number(),at:input.date()}),
      authorize:({c,input})=>c.req.header('x-api-access')==='yes' && input.body.amount<10,
      handler:async({input,c,signal})=>{
        if(signal.aborted)throw Error('PRIVATE_API_ABORT_SENTINEL');
        const runs=await audit(c,true);c.header('Set-Cookie','declared=ok; HttpOnly');
        return {id:input.params.id,total:input.query.page+input.body.amount,tags:input.query.tags,runs,at:new Date('2026-01-01')};
      }
    });
    export const GET=endpoint({handler:async({c})=>c.json({runs:await audit(c)})});
  `);
  await write('src/pages/(contracts)/api/native.ts', `
    import * as api from '@cossackframework/framework/api';
    const native=api.defineApi({handler:({c})=>{c.header('Set-Cookie','native=ok; HttpOnly');return c.redirect('/signed-in',303);}});
    export {native as default};
  `);
  await write('src/pages/api/output-error.ts', `import {input} from '@cossackframework/core';import {defineApi} from '@cossackframework/framework/api';
    export const POST=defineApi({output:input.object({amount:input.number()}),handler:()=>({amount:'PRIVATE_API_OUTPUT_SENTINEL'} as any)});
  `);
  await write('src/pages/api/deadline.ts', `import {defineApi} from '@cossackframework/framework/api';
    export const POST=defineApi({timeoutMs:20,handler:()=>new Promise<Response>(()=>{})});
  `);
  await write('src/api-types.ts', `import type {ApiRequest,ApiResponse,ApiRoutes} from 'virtual:cossack-routes';
    type Request=ApiRequest<'/api/declared/[id]','POST'>;
    const incoming:Request={params:{id:'a'},query:{page:'2',tags:['one']},body:{amount:3}};
    const output:ApiResponse<'/api/declared/[id]','POST'>={id:'a',total:5,tags:['one'],runs:1,at:'2026-01-01'};
    const native:ApiResponse<'/api/native','*'>=new Response();
    // @ts-expect-error missing body
    const missing:Request={params:{id:'a'},query:{page:'2',tags:[]}};
    // @ts-expect-error strict JSON number
    const wrong:Request={...incoming,body:{amount:'3'}};
    // @ts-expect-error date wire value
    const wrongOutput:ApiResponse<'/api/declared/[id]','POST'>={...output,at:new Date()};
    // @ts-expect-error method is not registered
    type WrongMethod=ApiRequest<'/api/declared/[id]','DELETE'>;
    // @ts-expect-error default handler takes precedence
    type WrongDefault=ApiResponse<'/api/native','POST'>;
    // @ts-expect-error arbitrary route is not an API
    type WrongName=ApiResponse<'/missing','POST'>;
  `);
}

export async function checkApiContractAcceptance(send) {
  const url = '/api/declared/%E9%9B%AA%2Fa?page=2&tags=one&tags=%E9%9B%AA';
  const call = (body, options = {}) => send(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-access': 'yes' }, body: JSON.stringify(body), ...options });
  const error = async (response, status, code) => {
    expect(response.status).toBe(status); const data = await response.json();
    expect(data.code).toBe(code); expect(data.requestId).toBe(response.headers.get('X-Cossack-Request-Id')); return data;
  };
  expect(await (await send(url)).json()).toEqual({ runs: 0 });
  const invalid = await error(await call({ amount: '3' }), 400, 'COSSACK_VALIDATION_FAILED');
  expect(invalid.fieldErrors.body.amount).toBeTruthy();
  await error(await call({ amount: 3 }, { headers: { 'Content-Type': 'application/json' } }), 403, 'COSSACK_AUTH_FORBIDDEN');
  await error(await call({ amount: 3 }, { body: '{broken' }), 400, 'COSSACK_API_JSON_INVALID');
  await error(await call({ amount: 3 }, { headers: { 'Content-Type': 'text/plain' } }), 415, 'COSSACK_API_MEDIA_TYPE');
  expect(await (await send(url)).json()).toEqual({ runs: 0 });
  const success = await call({ amount: 3 }); expect(success.status).toBe(200);
  expect(success.headers.getSetCookie()).toEqual(['declared=ok; HttpOnly']);
  expect(await success.json()).toEqual({ id: '雪/a', total: 5, tags: ['one', '雪'], runs: 1, at: '2026-01-01T00:00:00.000Z' });
  expect(await (await send(url)).json()).toEqual({ runs: 1 });
  const native = await send('/api/native', { redirect: 'manual' }); expect(native.status).toBe(303);
  expect(native.headers.get('Location')).toBe('/signed-in'); expect(native.headers.getSetCookie()).toEqual(['native=ok; HttpOnly']);
  const output = await error(await send('/api/output-error', { method: 'POST' }), 500, 'COSSACK_API_INTERNAL');
  expect(JSON.stringify(output)).not.toContain('PRIVATE_API_OUTPUT_SENTINEL'); expect(output.fieldErrors).toBeUndefined();
  await error(await send('/api/deadline', { method: 'POST' }), 504, 'COSSACK_API_TIMEOUT');
}

export async function checkApiContractAssets(root) {
  for (const name of await fs.readdir(path.join(root, 'dist/client/assets'))) if (name.endsWith('.js')) {
    const code = await fs.readFile(path.join(root, 'dist/client/assets', name), 'utf8');
    for (const privateText of ['PRIVATE_API_', 'native_api_audit', 'defineApi', 'node:fs']) expect(code, name).not.toContain(privateText);
  }
}
