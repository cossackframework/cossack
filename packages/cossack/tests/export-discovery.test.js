import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverExports, targetKind } from '../src/export-discovery.js';
const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
async function fixture(files){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-exports-')); roots.push(root);
  for(const file of files){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),'');}
  return root;
}
it('expands nested subpaths and honors null exclusions and more-specific overrides',async()=>{
  const root=await fixture(['dist/first.js','dist/nested/second.js','dist/private/hidden.js','special/first.js','dist/exact.js']);
  const result=await discoverExports(root,'pkg',{'./*':'./dist/*.js','./private/*':null,'./nested/*':'./special/*.js','./exact':null});
  expect(result.discovery).toMatchObject({status:'complete'});
  const concrete=result.entries.filter(entry=>!entry.subpath.includes('*'));
  expect(concrete.map(entry=>entry.subpath)).toEqual(['./exact','./first','./nested/first','./nested/second']);
  expect(concrete.find(entry=>entry.subpath==='./nested/second').targets).toEqual([{conditions:[],target:'./special/second.js',status:'missing'}]);
  expect(concrete.find(entry=>entry.subpath==='./exact').targets[0].status).toBe('blocked');
  expect(concrete.some(entry=>entry.subpath.includes('hidden'))).toBe(false);
});
it('replaces repeated target stars with the same capture and respects trailers',async()=>{
  const root=await fixture(['dist/a/a.d.ts','dist/a/b.d.ts','dist/a/a.js']);
  const result=await discoverExports(root,'pkg',{'./*.js':{types:'./dist/*/*.d.ts',default:'./dist/*/*.js'}});
  expect(result.entries.filter(entry=>entry.pattern).map(entry=>entry.subpath)).toEqual(['./a.js']);
  expect(result.entries.find(entry=>entry.pattern).targets.map(target=>target.target)).toEqual(['./dist/a/a.d.ts','./dist/a/a.js']);
});
it('does not enumerate unreachable default branches or filesystem fallback guesses',async()=>{
  const root=await fixture(['dist/hidden.js','dist/visible.js']);
  const result=await discoverExports(root,'pkg',{'./*':{default:null,node:'./dist/*.js'},'./fallback/*':['./missing/*.js','./dist/*.js']});
  expect(result.entries.filter(entry=>entry.pattern)).toEqual([]);
});
it('reports finite-discovery limits and skips internal symlink traversal',async()=>{
  const root=await fixture(['dist/one.js']);
  await fs.symlink(path.join(root,'dist'),path.join(root,'linked'),'dir');
  const result=await discoverExports(root,'pkg',{'./constant/*':'./dist/one.js','./linked/*':'./linked/*.js','./encoded/*':'./dist/%20*.js'});
  expect(result.discovery).toEqual({status:'partial',reasons:['constant-pattern-target','symlink-skipped','unsupported-pattern-target']});
  expect(result.entries.filter(entry=>entry.pattern)).toEqual([]);
});
it.each(['./../secret','./%2e%2e/secret','./node_modules/dep/file','./NODE_MODULES/file','./x/%2fsecret','./x//file','./x/./file'])('rejects invalid export targets %s',target=>{
  expect(targetKind(target)).toBe('invalid');
});
it('refreshes the wildcard inventory when files change',async()=>{
  const root=await fixture(['dist/first.js']);
  const map={'./*':'./dist/*.js'};
  const before=await discoverExports(root,'pkg',map);
  await fs.unlink(path.join(root,'dist/first.js'));await fs.writeFile(path.join(root,'dist/second.js'),'');
  const after=await discoverExports(root,'pkg',map);
  expect(before.entries.filter(entry=>entry.pattern).map(entry=>entry.subpath)).toEqual(['./first']);
  expect(after.entries.filter(entry=>entry.pattern).map(entry=>entry.subpath)).toEqual(['./second']);
});
it('does not traverse branches after an invalid default or an empty fallback array',async()=>{
  const root=await fixture(['dist/hidden.js']);
  const result=await discoverExports(root,'pkg',{'./bad/*':{default:'../invalid/*.js',node:'./dist/*.js'},'./empty/*':{default:[],node:'./dist/*.js'}});
  expect(result.entries.filter(entry=>entry.pattern)).toEqual([]);
});
it('allows a valid fallback after an invalid target, without falling back on missing files',async()=>{
  const root=await fixture(['dist/public.js']);
  const result=await discoverExports(root,'pkg',{'./*':['../invalid/*.js','./dist/*.js']});
  expect(result.entries.filter(entry=>entry.pattern).map(entry=>entry.subpath)).toEqual(['./public']);
});
it('agrees with native Node resolution for concrete overrides and private exclusions',async()=>{
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const {pathToFileURL}=await import('node:url');
  const root=await fixture(['dist/open.js','dist/private/hidden.js','dist/exact.js','special/open.js']);
  const map={'./*':'./dist/*.js','./private/*':null,'./exact':'./special/open.js'};
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'pkg',type:'module',exports:map}));
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','--eval',`const specs=['pkg/open','pkg/exact','pkg/private/hidden']; console.log(JSON.stringify(specs.map(spec=>{try{return import.meta.resolve(spec)}catch(error){return error.code}})));`],{cwd:root});
  expect(JSON.parse(stdout)).toEqual([pathToFileURL(path.join(root,'dist/open.js')).href,pathToFileURL(path.join(root,'special/open.js')).href,'ERR_PACKAGE_PATH_NOT_EXPORTED']);
  const result=await discoverExports(root,'pkg',map);
  expect(result.entries.find(entry=>entry.subpath==='./exact').targets[0].target).toBe('./special/open.js');
  expect(result.entries.filter(entry=>entry.pattern).map(entry=>entry.subpath)).toEqual(['./open']);
});

it('keeps numeric text after repeated stars separate from the capture reference',async()=>{
  const root=await fixture(['dist/a/a1.js']);
  const result=await discoverExports(root,'pkg',{'./*':'./dist/*/*1.js'});
  expect(result.entries.filter(entry=>entry.pattern).map(entry=>entry.subpath)).toEqual(['./a']);
});
