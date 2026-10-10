import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspectCommand, checkCommand } from '../src/commands/inspect.js';
import { inspectProviders } from '../src/providers-inspection.js';

const roots = [], require = createRequire(import.meta.url);
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => fs.rm(root, {recursive:true,force:true}))); });
async function fixture(source, config = {}, runtime) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-providers-')); roots.push(root);
  await fs.mkdir(path.join(root,'node_modules'));
  await fs.symlink(path.dirname(require.resolve('wrangler/package.json')),path.join(root,'node_modules/wrangler'),'junction');
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify(runtime ? {cossack:{runtime}} : {}));
  await fs.writeFile(path.join(root,'index.js'),'export default {fetch(){return new Response("ok")}}');
  await fs.writeFile(path.join(root,'wrangler.jsonc'),JSON.stringify({name:'fixture',main:'./index.js',compatibility_date:'2026-06-06',...config}));
  await fs.mkdir(path.join(root,'src/config'),{recursive:true});
  if (source !== undefined) await fs.writeFile(path.join(root,'src/config/cache.ts'),source);
  return {cwd:root,flags:{json:true}};
}
const config = (driver='kv',requires='{}') => `export default ({env}) => ({default: env('CACHE_DRIVER', 'main'), stores: {
 main: {driver: '${driver}', binding: 'CACHE', requires: ${requires}} }});`;
const kv = {kv_namespaces:[{binding:'CACHE',id:'a'.repeat(32)}]};
it.each([null, 42, 'https://PRIVATE_TOKEN'])('rejects invalid literal cache drivers without disclosing values (%#)', async driver => {
  const ctx = await fixture(`export default { default:'main', stores:{main:{driver:${JSON.stringify(driver)}}} };`);
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await checkCommand(['providers'],ctx)).toBe(1);
  const result = JSON.parse(log.mock.calls[0][0]);
  expect(result.diagnostics.map(d=>d.code)).toContain('COSSACK_CACHE_DRIVER_INVALID');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
});
it('inspects selected environment declarations/units without revealing credentials or writing files', async () => {
  vi.stubEnv('CLOUDFLARE_ENV','staging');
  const ctx = await fixture(config('kv','{shared:true,millisecondExpiry:true}'),{env:{staging:{...kv,
    vars:{rateLimit:'redis',UPSTASH_REDIS_REST_URL:'https://PRIVATE.test',UPSTASH_REDIS_REST_TOKEN:'PRIVATE_TOKEN'}}}});
  const before = await fs.readdir(ctx.cwd); const source = await fs.readFile(path.join(ctx.cwd,'src/config/cache.ts'),'utf8');
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await inspectCommand(['providers'],ctx)).toBe(0); expect(log).toHaveBeenCalledOnce();
  const result = JSON.parse(log.mock.calls[0][0]);
  expect(result).toMatchObject({schemaVersion:1,ok:true,data:{scope:'providers',environment:'staging',
    cache:{default:{name:'main'},stores:[{driver:'kv',capabilities:{durationUnit:'milliseconds',locality:'shared',consistency:'eventual',atomicIncrement:false}}]},
    rateLimit:{status:'declared',capabilities:{provider:'redis',atomicIncrement:true,persistence:'unknown'}}}});
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(await checkCommand(['providers'],ctx)).toBe(0);
  expect(await fs.readdir(ctx.cwd)).toEqual(before);
  expect(await fs.readFile(path.join(ctx.cwd,'src/config/cache.ts'),'utf8')).toBe(source);
});
it('inspection describes unsupported guarantees; checks fail with the same coded diagnostics', async () => {
  const ctx = await fixture(config('kv','{atomicIncrement:true,strongConsistency:true}'),kv);
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await inspectCommand(['providers'],ctx)).toBe(0);
  expect(await checkCommand(['providers'],ctx)).toBe(1);
  const [inspection,check] = log.mock.calls.map(([text])=>JSON.parse(text));
  expect(check).toMatchObject({ok:false,diagnostics:inspection.diagnostics});
  expect(check.diagnostics[0].code).toBe('COSSACK_STORAGE_GUARANTEE_UNSUPPORTED');
});
it.each(['toString','constructor','__proto__','unknown',null])('rejects invalid explicit backend selection without inherited aliases (%#)', async rateLimit => {
  const ctx = await fixture(config('memory'),{vars:{rateLimit}});
  const result = await inspectProviders(ctx.cwd);
  expect(result.rateLimit).toMatchObject({status:'invalid',capabilities:{provider:'custom'}});
  expect(result.diagnostics.map(d=>d.code)).toContain('COSSACK_RATE_LIMIT_PROVIDER_INVALID');
});
it('missing/null bindings and missing selected environments remain errors', async () => {
  const ctx = await fixture(`export default {default:'main', stores:{main:{driver:'kv',binding:null}}}`,kv);
  expect((await inspectProviders(ctx.cwd)).diagnostics.map(d=>d.code)).toContain('COSSACK_CACHE_BINDING_UNKNOWN');
  expect((await inspectProviders(ctx.cwd,'missing')).diagnostics.map(d=>d.code)).toContain('COSSACK_PROVIDER_ENV_UNKNOWN');
});
it('reports unavailable optional stores without failing a valid memory default', async () => {
  const ctx = await fixture(`export default { default:'memory', stores:{ memory:{driver:'memory'}, edge:{driver:'kv'} } };`);
  const result = await inspectProviders(ctx.cwd);
  expect(result.cache.stores[1]).toMatchObject({bindingStatus:'missing'});
  expect(result.diagnostics).toContainEqual(expect.objectContaining({code:'COSSACK_CACHE_BINDING_MISSING',severity:'warning'}));
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await checkCommand(['providers'],ctx)).toBe(0); expect(JSON.parse(log.mock.calls[0][0]).ok).toBe(true);
  await fs.writeFile(path.join(ctx.cwd,'src/config/cache.ts'), `export default { default:'edge', stores:{ edge:{driver:'kv'} } };`);
  expect(await checkCommand(['providers'],ctx)).toBe(1);
});
it('finds override candidates without executing their side effects or borrowing builtin guarantees', async () => {
  const ctx = await fixture(config('kv','{shared:true}'),kv);
  await fs.writeFile(path.join(ctx.cwd,'src/register.ts'),`import {extendCacheDriver, cache} from '@cossackframework/framework/cache';
import {setRateLimitStore} from '@cossackframework/core';
throw Error('PRIVATE'); extendCacheDriver('kv',()=>provider); setRateLimitStore(provider); cache.setDefaultStore(provider);`);
  const result = await inspectProviders(ctx.cwd);
  expect(result).toMatchObject({cache:{default:{status:'unknown'},stores:[{capabilities:{provider:'custom',locality:'unknown'}}]},
    rateLimit:{status:'unknown',capabilities:{provider:'custom'}},overrideCandidates:['/src/register.ts']});
  expect(result.diagnostics.map(d=>d.code)).toContain('COSSACK_STORAGE_GUARANTEE_UNSUPPORTED');
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('dynamic factories and non-Cloudflare request environments stay unknown', async () => {
  const ctx = await fixture(`export default buildCache('PRIVATE');`,{},'node');
  const result = await inspectProviders(ctx.cwd);
  expect(result).toMatchObject({runtime:'node',cache:{default:{status:'unknown'}},rateLimit:{status:'unknown'}});
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('uses implicit memory only when configuration is absent; valid store labels and human scope/units are preserved', async () => {
  const ctx = await fixture(undefined);
  const result = await inspectProviders(ctx.cwd); expect(result.cache.stores[0].capabilities.provider).toBe('memory');
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await inspectCommand(['providers'],{...ctx,flags:{}})).toBe(0);
  expect(log.mock.calls.flat().join(' ')).toContain('durations=milliseconds');
  expect(log.mock.calls.flat().join(' ')).toContain('not verified');
  await fs.writeFile(path.join(ctx.cwd,'src/config/cache.ts'), `export default {default:'invalid',stores:{invalid:{driver:'memory'}}};`);
  expect(await checkCommand(['providers'],ctx)).toBe(0);
  expect(JSON.parse(log.mock.calls.at(-1)[0]).data.cache.default).toEqual({status:'declared',name:'invalid'});
});
it.each([{env:true},{env:['a','b']},{typo:true}])('rejects invalid flags through the shared command contract (%#)', async flags => {
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await checkCommand(['providers'],{cwd:'/missing-project',flags:{...flags,json:true}})).toBe(1);
  expect(log).toHaveBeenCalledOnce(); expect(JSON.parse(log.mock.calls[0][0]).ok).toBe(false);
});
