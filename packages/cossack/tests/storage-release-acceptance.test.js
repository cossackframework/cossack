import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTestHarness } from 'wrangler';
import { writeStorageAcceptance, checkStorageAcceptance } from './fixtures/storage-acceptance.js';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
it('proves authorized R2 CRUD, signed access, cancellation and streamed transfers in actual workerd',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-r2-release-'));let harness;
 try {
  await fs.mkdir(path.join(root,'node_modules/@cossackframework'),{recursive:true});
  const installed=process.env.COSSACK_STORAGE_INSTALLED_ROOT;
  for(const name of ['core','framework'])await fs.symlink(installed?path.join(installed,'node_modules/@cossackframework',name):path.join(repository,'packages',name),path.join(root,'node_modules/@cossackframework',name),'junction');
  await writeStorageAcceptance(root);try { await promisify(execFile)(process.execPath,[path.join(repository,'node_modules/typescript/bin/tsc'),'--ignoreConfig','--strict','--skipLibCheck','--noEmit','--module','ESNext','--moduleResolution','Bundler','--target','ESNext','worker.ts'],{cwd:root,timeout:30000,maxBuffer:1024*1024}); } catch(error) {throw new Error(`Storage public declarations: ${error.stdout}\n${error.stderr}`);}harness=createTestHarness({root,workers:[{configPath:path.join(root,'wrangler.jsonc')}]});await harness.listen();
  await checkStorageAcceptance((url,options)=>harness.fetch(url,{redirect:'manual',...options}));
 } finally {await harness?.close();await fs.rm(root,{recursive:true,force:true});}
},120000);

it('resolves published storage exports and strictly checks all provider contracts',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-storage-public-'));const installed=process.env.COSSACK_STORAGE_INSTALLED_ROOT;
 try {
  await fs.mkdir(path.join(root,'node_modules/@cossackframework'),{recursive:true});
  for(const name of ['core','framework','node-adapter'])await fs.symlink(installed?path.join(installed,'node_modules/@cossackframework',name):path.join(repository,'packages',name),path.join(root,'node_modules/@cossackframework',name),'junction');
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));
  await fs.writeFile(path.join(root,'public-imports.mjs'),`import assert from 'node:assert/strict';
for(const [entry,symbol] of [['@cossackframework/core/storage','Storage'],['@cossackframework/framework/storage/r2','createR2StorageProvider'],['@cossackframework/framework/storage/s3','createS3StorageProvider'],['@cossackframework/node-adapter/storage','LocalStorageProvider']]) {const module=await import(entry);assert.equal(typeof module[symbol],'function');}
console.log('PUBLIC_STORAGE_IMPORTS=4');`);
  const imported=await promisify(execFile)(process.execPath,['public-imports.mjs'],{cwd:root,timeout:30000,maxBuffer:1024*1024});expect(imported.stdout).toContain('PUBLIC_STORAGE_IMPORTS=4');
  await fs.writeFile(path.join(root,'contracts.ts'),`
import { Storage, type StorageProvider } from '@cossackframework/core/storage';
import { createR2StorageProvider, type R2StorageBucket } from '@cossackframework/framework/storage/r2';
import { createS3StorageProvider } from '@cossackframework/framework/storage/s3';
import { LocalStorageProvider } from '@cossackframework/node-adapter/storage';
declare const bucket:R2StorageBucket;
declare const client:Parameters<typeof createS3StorageProvider>[0]['client'];
const providers:StorageProvider[]=[createR2StorageProvider(bucket),createS3StorageProvider({client,bucket:'server-owned'}),new LocalStorageProvider({root:'/isolated/application-owned'})];
for(const provider of providers) {
 const storage=new Storage<string>({provider,authorize:({context,key})=>key.startsWith(context+'/')});
 storage.put('alice','alice/file',new ReadableStream<Uint8Array>(),{size:0});
 // @ts-expect-error declared byte counts cannot be strings
 provider.put('alice/file',new ReadableStream<Uint8Array>(),{size:'zero'});
}
`);
  try {await promisify(execFile)(process.execPath,[path.join(repository,'node_modules/typescript/bin/tsc'),'--ignoreConfig','--strict','--skipLibCheck','--noEmit','--module','ESNext','--moduleResolution','Bundler','--target','ESNext','contracts.ts'],{cwd:root,timeout:30000,maxBuffer:1024*1024});}catch(error){throw new Error(`Storage public provider types: ${error.stdout}\n${error.stderr}`);}
 }finally{await fs.rm(root,{recursive:true,force:true});}
},40000);
