import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readDocumentation } from '../src/documentation-service.js';
import { docsCommand } from '../src/commands/docs.js';
import { readPackageVersion } from '../src/pkg.js';
const exec = promisify(execFile), roots = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, {recursive:true,force:true}))); });
async function fixture(exports = { '.': { types:'./index.d.ts', import:'./index.js' } }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'cossack-docs-')); roots.push(root);
  const folder = path.join(root,'node_modules/@cossackframework/core'); await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),'{}');
  const manifest = {name:'@cossackframework/core',version:'0.1.2',exports};
  await fs.writeFile(path.join(folder,'package.json'),JSON.stringify(manifest));
  await fs.writeFile(path.join(folder,'index.js'),'throw new Error("entrypoint must not execute")');
  await fs.writeFile(path.join(folder,'index.d.ts'),'export declare const present: string;');
  return {root,folder,manifest};
}
it('reads installed versions and conditional public targets without importing code',async()=>{
  const {root}=await fixture({'.':{types:'./index.d.ts',import:'./index.js'},'./blocked':null,'./missing':'./missing.js','./pattern/*':'./dist/*.js'});
  const result=await readDocumentation(root,{package:'@cossackframework/core'});
  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({cliVersion:readPackageVersion(),coverage:{symbols:'not-indexed',runtimeSupport:'not-verified'}});
  expect(result.data.packages[0]).toMatchObject({name:'@cossackframework/core',version:'0.1.2',installed:true,exports:[
    {import:'@cossackframework/core',targets:[{conditions:['types'],status:'present'},{conditions:['import'],status:'present'}]},
    {import:'@cossackframework/core/blocked',targets:[{status:'blocked'}]},
    {import:'@cossackframework/core/missing',targets:[{status:'missing'}]},
    {import:'@cossackframework/core/pattern/*',targets:[{status:'pattern-not-expanded'}]},
  ]});
  expect(result.data.commands.find(command=>command.name==='docs').options.package.choices).toContain('@cossackframework/core');
});
it('refreshes removed exports and versions instead of serving stale workspace facts',async()=>{
  const {root,folder,manifest}=await fixture(); const before=await readDocumentation(root,{package:manifest.name});
  await fs.writeFile(path.join(folder,'package.json'),JSON.stringify({...manifest,version:'0.1.3',exports:{'./replacement':'./index.js'}}));
  const after=await readDocumentation(root,{package:manifest.name});
  expect(after.data.packages[0].version).toBe('0.1.3');
  expect(after.data.packages[0].manifestHash).not.toBe(before.data.packages[0].manifestHash);
  expect(after.data.packages[0].exports.map(entry=>entry.import)).toEqual(['@cossackframework/core/replacement']);
});
it('rejects arbitrary package paths and reports malformed manifests without their values',async()=>{
  const {root,folder}=await fixture();
  await expect(readDocumentation(root,{package:'../../secret'})).rejects.toMatchObject({code:'COSSACK_DOCS_PACKAGE_UNKNOWN'});
  await fs.writeFile(path.join(folder,'package.json'),'{"private-secret":');
  const result=await readDocumentation(root,{package:'@cossackframework/core'});
  expect(result).toMatchObject({ok:false,diagnostics:[{code:'COSSACK_DOCS_MANIFEST_INVALID'}]});
  expect(JSON.stringify(result)).not.toContain('private-secret');
});
it('distinguishes legacy manifests, absent packages and invalid escaping targets',async()=>{
  const {root,folder,manifest}=await fixture({'.':'../outside-secret'});
  const invalid=await readDocumentation(root,{package:manifest.name});
  expect(invalid.data.packages[0].exports[0].targets).toEqual([{conditions:[],target:null,status:'invalid'}]);
  await fs.writeFile(path.join(folder,'package.json'),JSON.stringify({name:manifest.name,version:'0.1.2',main:'index.js'}));
  const legacy=await readDocumentation(root,{package:manifest.name});
  expect(legacy.data.packages[0]).toMatchObject({exports:[],legacyEntries:{main:'index.js',types:null}});
  const absent=await readDocumentation(root,{package:'@cossackframework/auth'});
  expect(absent.data.packages).toEqual([{name:'@cossackframework/auth',installed:false}]);
});
it('CLI emits one standard envelope containing the shared service data',async()=>{
  const {root}=await fixture(); const result=await readDocumentation(root,{package:'@cossackframework/core'});
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await docsCommand([],{cwd:root,flags:{json:true,package:'@cossackframework/core'}})).toBe(0);
  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.parse(log.mock.calls[0][0])).toEqual({schemaVersion:1,command:'docs',...result});
});
it('CLI subprocess accepts offline discovery and rejects invalid flags before effects',async()=>{
  const {root}=await fixture(); const bin=fileURLToPath(new URL('../bin/cossack.js',import.meta.url));
  const {stdout,stderr}=await exec(process.execPath,[bin,'docs','--package','@cossackframework/core','--json'],{cwd:root});
  expect(stderr).toBe(''); expect(JSON.parse(stdout)).toMatchObject({command:'docs',ok:true,data:{packages:[{version:'0.1.2'}]}});
  const failure=await exec(process.execPath,[bin,'docs','--package','../../secret','--json'],{cwd:root}).catch(error=>error);
  expect(failure.code).toBe(1); expect(JSON.parse(failure.stdout).ok).toBe(false);
},30000);
