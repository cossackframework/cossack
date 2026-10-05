import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
const repository=path.resolve(import.meta.dirname,'../../..');

it('strictly compiles every unchanged migration TypeScript fence with public APIs and explicit application context',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-migration-guide-'));
 const installed=process.env.COSSACK_MIGRATION_INSTALLED_ROOT;
 try {
  await fs.writeFile(path.join(root,'package.json'),'{"private":true,"type":"module"}');
  await fs.mkdir(path.join(root,'node_modules/@cossackframework'),{recursive:true});
  const dependencies=installed?path.join(installed,'node_modules'):path.join(repository,'node_modules');
  for(const name of await fs.readdir(dependencies)) {
   if(name.startsWith('.')||name==='@cossackframework')continue;
   await fs.symlink(path.join(dependencies,name),path.join(root,'node_modules',name),'junction');
  }
  for(const name of ['core','renderer','ui'])await fs.symlink(installed?path.join(dependencies,'@cossackframework',name):path.join(repository,'packages',name),path.join(root,'node_modules/@cossackframework',name),'junction');
  const markdown=await fs.readFile(path.join(repository,'specs/migration-0.9.0.md'),'utf8');
  const snippets=[...markdown.matchAll(/^```(?:ts|typescript)\n([\s\S]*?)^```/gm)].map(match=>match[1]);
  expect(snippets).toHaveLength(9);
  // Method/context declarations are application fixtures, not authentication, transports, uploads or provider implementations.
  const wrappers=[
   [`declare const email:string,password:string,name:string,token:string;
class AuthDraft {
 declare login:(payload:{email:string,password:string})=>Promise<void>;
 declare register:(payload:{name:string,email:string,password:string})=>Promise<void>;
 declare requestReset:(payload:{email:string})=>Promise<void>;
 declare doReset:(payload:{token:string,password:string})=>Promise<void>;
 async submit(){`, '} }\nexport {};'],
   [`import type {RpcCall} from '@cossackframework/core';
declare const input:{name:string};
class SaveDraft {
 declare savedId:string;
 declare save:(payload:{name:string})=>RpcCall<{id:string},{id:string}>;
 async submit(){`, '} }'],
   [`import {rpc$} from '@cossackframework/core';
class ProgressDraft {
 declare progress:number;declare total:number;
 async *generate(count:number){yield {step:count};return {total:count};}
 async submit(){`, '} }'],
   [`import {rpc$} from '@cossackframework/core';
class DateDraft {
 async loadRecord(){return {createdAt:new Date()};}
 async submit(){`, '} }'],
   [`import {component} from '@cossackframework/renderer';
import {Field,Input} from '@cossackframework/ui';
declare const error:string|undefined,value:string;`, ''],
   [`import {component,html} from '@cossackframework/renderer';
import {Carousel} from '@cossackframework/ui';
declare const photos:readonly {id:string,description:string,url:string}[];`, ''],
   [`import {component} from '@cossackframework/renderer';
import {Attachment} from '@cossackframework/ui';
declare const file:{id:string,name:string,displaySize:string};
declare const saving:boolean;
declare const removeFile:(id:string)=>void;`, ''],
   [`import {component} from '@cossackframework/renderer';
import {Bubble} from '@cossackframework/ui';`, ''],
   [`import {component} from '@cossackframework/renderer';
import {MessageScroller} from '@cossackframework/ui';
declare const messageContent:unknown;`, ''],
  ];
  const files=[];
  for(let index=0;index<snippets.length;index++) {
   const filename=`example-${index+1}.ts`;files.push(filename);
   const text=wrappers[index][0]+'\n'+snippets[index]+'\n'+wrappers[index][1];
   await fs.writeFile(path.join(root,filename),text);expect(text).toContain(snippets[index]);
  }
  await fs.writeFile(path.join(root,'negative.ts'),`import {rpc$} from '@cossackframework/core';
import {component} from '@cossackframework/renderer';
import {Input,MessageScroller,Attachment} from '@cossackframework/ui';
const result=await rpc$(Promise.resolve({createdAt:new Date()}));
const serialized:string=result.createdAt;
// @ts-expect-error RPC dates are serialized strings, not live Date objects.
const nativeDate:Date=result.createdAt;
// @ts-expect-error Inputs retain native email type vocabulary.
component(Input,{type:'invalid-email-kind'});
// @ts-expect-error Scroll controls expose native @event bindings, not lowercase handler attributes.
component(MessageScroller,{id:'messages',viewportProps:{onscroll:()=>{}}});
// @ts-expect-error Disabled controls require a boolean instead of a numeric loading counter.
component(Attachment,{name:'file',removeProps:{disabled:1}});
void [serialized,nativeDate];
`);files.push('negative.ts');
  const require=createRequire(path.join(root,'package.json'));
  const compiler=path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc');
  for(const mode of ['Bundler','NodeNext']) {
   const config=`tsconfig.${mode}.json`;
   await fs.writeFile(path.join(root,config),JSON.stringify({compilerOptions:{target:'ES2022',module:mode==='Bundler'?'ESNext':'NodeNext',moduleResolution:mode,strict:true,noEmit:true,skipLibCheck:true,types:[],lib:['ES2022','DOM']},files}));
   try{await execute(process.execPath,[compiler,'--project',config],{cwd:root,timeout:30000,maxBuffer:1024*1024});}
   catch(error){throw new Error(`${mode}: ${error.stdout}\n${error.stderr}`);}
  }
 } finally {await fs.rm(root,{recursive:true,force:true});}
},70000);
