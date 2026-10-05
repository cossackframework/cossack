import { expect,it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const repository=fileURLToPath(new URL('../../../',import.meta.url));const execute=promisify(execFile);
async function files(folder){const result=[];for(const item of await fs.readdir(folder,{withFileTypes:true})){if(item.name==='create-desktop-app'||item.name==='desktop.md')continue;const file=path.join(folder,item.name);if(item.isDirectory())result.push(...await files(file));else if(item.name.endsWith('.md'))result.push(file);}return result;}
it('keeps non-Desktop skill policies aligned with public 0.9 APIs and offline guides',async()=>{
 const docs=await Promise.all((await files(path.join(repository,'skills'))).map(async file=>[file,await fs.readFile(file,'utf8')]));
 const byName=Object.fromEntries(docs.map(([file,text])=>[path.relative(path.join(repository,'skills'),file),text]));
 expect(byName['cossack-best-practices/references/decorators.md']).not.toMatch(/Memoized — recomputed only/);
 expect(byName['cossack-best-practices/references/server-client-rpc.md']).not.toMatch(/Only `@Server\(\)` and `@Shared\(\)`|user.*argument is server-injected/);
 expect(byName['cossack-best-practices/references/forms.md']).not.toMatch(/default.*flash both input|auto-flashes.*input.*by default/);
 expect(byName['setup-websocket/SKILL.md']).toContain('COSSACK_SSE');expect(byName['setup-websocket/SKILL.md']).not.toContain('no binding required');
 const reference=byName['cossack-best-practices/references/services-storage-workflows.md'];
 expect(reference).toContain('process-only');expect(reference).toContain('Native SVC-04 acceptance remains open');expect(reference).toContain('not proven');
 const catalog=JSON.parse(await fs.readFile(path.join(repository,'packages/core/agent-docs.json'),'utf8'));
 for(const id of ['scoped-services-and-injection','authorized-object-storage','local-workflow-lifecycle','runtime-and-counter-guarantees','server-action-access-policy','accessible-form-controller'])expect(docs.some(([,text])=>text.includes(id)),id).toBe(true);
 for(const [,text]of docs){expect(text).not.toContain('--guide <');expect(text).not.toMatch(/from ['"]@cossackframework\/[^'"]+\/(?:src|dist)\//);}
 expect(catalog.guides.find(guide=>guide.id==='local-workflow-lifecycle').markdown).toContain('native acceptance remains open');
});
it('strictly checks every public named snippet import and executes portable ownership examples',async()=>{
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-skill-guides-'));
 try{
 const modules=path.join(scratch,'node_modules');await fs.mkdir(modules);
 for(const name of await fs.readdir(path.join(repository,'node_modules'))){if(name==='@cossackframework')continue;await fs.symlink(path.join(repository,'node_modules',name),path.join(modules,name),'junction');}
 const scope=path.join(modules,'@cossackframework');await fs.mkdir(scope);
 for(const name of ['core','renderer','framework','auth','database','ui','node-adapter'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'junction');
 for(const name of await fs.readdir(path.join(repository,'node_modules/@cossackframework')))if(!['core','renderer','framework','auth','database','ui','node-adapter'].includes(name))await fs.symlink(path.join(repository,'node_modules/@cossackframework',name),path.join(scope,name),'junction');
 await fs.writeFile(path.join(scratch,'package.json'),'{"type":"module"}');
 const imports=new Set();for(const file of await files(path.join(repository,'skills'))){const text=await fs.readFile(file,'utf8');for(const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](@cossackframework\/[^'"]+)['"]/g)){for(const item of match[1].split(',')){const symbol=item.trim().replace(/^type\s+/,'').split(/\s+as\s+/)[0];if(symbol)imports.add(JSON.stringify([symbol,match[2]]));}}}
 expect(imports.size).toBeGreaterThan(40);
 await fs.writeFile(path.join(scratch,'imports.ts'),[...imports].map((value,index)=>{const [symbol,module]=JSON.parse(value);return `import type { ${symbol} as Symbol${index} } from '${module}';`;}).join('\n'));
 const reference=await fs.readFile(path.join(repository,'skills/cossack-best-practices/references/services-storage-workflows.md'),'utf8');
 const sources=[...reference.matchAll(/```typescript\n([\s\S]*?)\n```/g)].map(match=>match[1]);expect(sources).toHaveLength(2);
 const filesToCheck=[path.join(scratch,'imports.ts')];for(const [index,source]of sources.entries()){const file=path.join(scratch,`example${index}.ts`);await fs.writeFile(file,source);filesToCheck.push(file);}
 await fs.writeFile(path.join(scratch,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',strict:true,noEmitOnError:true,experimentalDecorators:true,emitDecoratorMetadata:true,skipLibCheck:true,types:[],lib:['ES2022','DOM','DOM.Iterable'],outDir:path.join(scratch,'compiled')},files:filesToCheck}));
 await execute(process.execPath,[path.join(repository,'node_modules/typescript/bin/tsc'),'-p',path.join(scratch,'tsconfig.json')],{cwd:scratch,timeout:60000}).catch(error=>{throw new Error(String(error.stdout)+String(error.stderr),{cause:error});});
 for(let index=0;index<sources.length;index++){const result=await execute(process.execPath,[path.join(scratch,'compiled',`example${index}.js`)],{cwd:scratch,timeout:10000});expect(result.stderr).toBe('');}
 }finally{await fs.rm(scratch,{recursive:true,force:true});}
},90000);
