import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDocumentation } from '../src/documentation-service.js';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, {recursive:true,force:true}))); });
async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'cossack-declarations-')); roots.push(root);
  const folder = path.join(root,'node_modules/@cossackframework/core'); await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),'{}');
  await fs.writeFile(path.join(folder,'package.json'),JSON.stringify({name:'@cossackframework/core',version:'0.1.2',exports:{'.':{types:'./index.d.ts',import:'./runtime.js'}}}));
  await fs.writeFile(path.join(folder,'runtime.js'),'throw new Error("must never execute");');
  for (const [name,text] of Object.entries(files)) await fs.writeFile(path.join(folder,name),text);
  const read = () => readDocumentation(root,{package:'@cossackframework/core',symbols:true});
  return {root,folder,read};
}
it('resolves public aliases, star exports, overloads, generic types and class members',async()=>{
  const {read} = await fixture({
    'index.d.ts': `export { convert as parse, Thing as Widget } from './details.js'; export type { Options } from './details.js'; export * from './other.js'; export { default } from './default.js';`,
    'details.d.ts': `/** Convert an input. */
      export declare function convert(value:string):number;
      export declare function convert(value:number):string;
      export interface Options<T=string> { value:T; optional?:boolean; }
      declare class Parent { inherited():boolean; protected hidden():void; }
      export declare class Thing extends Parent { constructor(value:string); name:string; private secret; protected internal:string; #private; static build():Thing; run<T>(value:T):T; }
      declare const notExported: string;`,
    'other.d.ts': 'export type Result<T> = {value:T} | {error:string};',
    'default.d.ts': 'export default function make<T>(value:T): {value:T};',
  });
  const result=await read(), index=result.data.packages[0].declarations;
  expect(index.diagnostics).toEqual([]);
  expect(index).toMatchObject({compilerVersion:'6.0.3',status:'indexed',diagnosticCount:0});
  const symbols=index.entries[0].symbols;
  expect(symbols.map(s=>s.name)).toEqual(['default','Options','parse','Result','Widget']);
  expect(symbols.find(s=>s.name==='parse')).toMatchObject({documentation:'Convert an input.',callSignatures:['(value: string): number','(value: number): string'],source:{file:'details.d.ts'}});
  expect(symbols.find(s=>s.name==='Options').type).toContain('Options<T>');
  const widget=symbols.find(s=>s.name==='Widget');
  expect(widget.constructSignatures).toEqual(['(value: string): Thing']);
  expect(widget.members.map(s=>s.name)).toEqual(['inherited','name','run']);
  expect(widget.members.find(s=>s.name==='run').callSignatures).toEqual(['<T>(value: T): T']);
  expect(widget.staticMembers.map(s=>s.name)).toEqual(['build']);
  expect(JSON.stringify(index)).not.toContain('notExported');
},30000);
it('indexes type-only star and namespace re-exports without claiming runtime availability',async()=>{
  const {read}=await fixture({'index.d.ts':"export type * from './details.js'; export * as helpers from './details.js';",'details.d.ts':'export declare class Thing { run():void; } export type Value=string;'});
  const index=(await read()).data.packages[0].declarations;
  expect(index.status).toBe('indexed');
  expect(index.entries[0].symbols.map(s=>s.name)).toEqual(['helpers','Thing','Value']);
  expect(index.entries[0].symbols.every(s=>s.runtime==='not-verified')).toBe(true);
},30000);
it('refreshes referenced declarations even when package version and manifest stay unchanged',async()=>{
  const {folder,read}=await fixture({'index.d.ts':"export * from './details.js';",'details.d.ts':'export declare function before():string;'});
  const before=await read();
  await fs.writeFile(path.join(folder,'details.d.ts'),'export declare function after(value:number):boolean;');
  const after=await read();
  expect(after.data.packages[0].manifestHash).toBe(before.data.packages[0].manifestHash);
  expect(after.data.packages[0].declarations.declarationHash).not.toBe(before.data.packages[0].declarations.declarationHash);
  expect(after.data.packages[0].declarations.entries[0].symbols.map(s=>s.name)).toEqual(['after']);
},30000);
it('reports broken declaration graphs as partial instead of certifying inferred any types',async()=>{
  const {read}=await fixture({'index.d.ts':"export { missing } from './absent.js'; export declare const known: string;"});
  const result=await read(), index=result.data.packages[0].declarations;
  expect(index.status).toBe('partial'); expect(index.diagnosticCount).toBeGreaterThan(0);
  expect(index.entries[0].symbols.find(s=>s.name==='missing').status).toBe('unresolved');
  expect(result.diagnostics).toContainEqual(expect.objectContaining({code:'COSSACK_DOCS_DECLARATIONS_INCOMPLETE'}));
  expect(index.diagnostics.some(d=>d.code===2307)).toBe(true);
},30000);
it('distinguishes missing type files and non-module declarations',async()=>{
  const missing=await fixture({});
  expect((await missing.read()).data.packages[0].declarations.status).toBe('unavailable');
  const global=await fixture({'index.d.ts':'declare const privateGlobal:string;'});
  const index=(await global.read()).data.packages[0].declarations;
  expect(index.status).toBe('partial'); expect(index.entries[0]).toMatchObject({status:'not-a-module',symbols:[]});
},30000);
it('requires an explicit package for symbol work',async()=>{
  await expect(readDocumentation(os.tmpdir(),{symbols:true})).rejects.toMatchObject({code:'COSSACK_DOCS_PACKAGE_REQUIRED'});
});

it('retains CommonJS export-assignment signatures',async()=>{
  const {read}=await fixture({'index.d.ts':'declare function main(value:string):number; export = main;'});
  const index=(await read()).data.packages[0].declarations;
  expect(index.status).toBe('indexed');
  expect(index.entries[0].symbols).toContainEqual(expect.objectContaining({name:'export=',callSignatures:['(value: string): number']}));
},30000);

it('indexes a legacy types entry without fabricating an exports map',async()=>{
  const {folder,read}=await fixture({'index.d.ts':'export declare function legacy():string;'});
  await fs.writeFile(path.join(folder,'package.json'),JSON.stringify({name:'@cossackframework/core',version:'0.1.2',main:'runtime.js',types:'index.d.ts'}));
  const pkg=(await read()).data.packages[0];
  expect(pkg.exports).toEqual([]);
  expect(pkg.declarations.status).toBe('indexed');
  expect(pkg.declarations.entries[0].symbols[0].name).toBe('legacy');
},30000);

it('does not advertise inaccessible constructors as public calls',async()=>{
  const {read}=await fixture({'index.d.ts':`export declare class Locked { private constructor(); static open():Locked; } export declare abstract class Base { protected constructor(value:string); abstract run():void; }`});
  const symbols=(await read()).data.packages[0].declarations.entries[0].symbols;
  expect(symbols.find(s=>s.name==='Locked').constructSignatures).toEqual([]);
  expect(symbols.find(s=>s.name==='Base')).toMatchObject({abstract:true,constructSignatures:[]});
},30000);

it('indexes object helpers, enum values and namespace APIs without primitive prototype noise',async()=>{
  const {read}=await fixture({'index.d.ts':`export declare const codec: { parse<T>(value:string):T; readonly name:string }; export declare enum Mode { First, Second } export declare namespace Helpers { function run(value:number):string; } export type Text=string;`});
  const symbols=(await read()).data.packages[0].declarations.entries[0].symbols;
  expect(symbols.find(s=>s.name==='codec').valueMembers.map(s=>s.name)).toEqual(['name','parse']);
  expect(symbols.find(s=>s.name==='codec').valueMembers.find(s=>s.name==='parse').callSignatures).toEqual(['<T>(value: string): T']);
  expect(symbols.find(s=>s.name==='Mode').valueMembers.map(s=>s.name)).toEqual(['First','Second']);
  expect(symbols.find(s=>s.name==='Helpers').valueMembers[0].callSignatures).toEqual(['(value: number): string']);
  expect(symbols.find(s=>s.name==='Text').members).toEqual([]);
},30000);
