import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readPackageGuidance } from '../src/package-guidance.js';
import { linkRepositoryModules } from './fixtures/linked-app.js';

const repository=fileURLToPath(new URL('../../../',import.meta.url));
const execute=promisify(execFile);
const coverage={
 'reactive-field-validation':['storeRules','validateValue','ValidationRule'],
 'server-action-access-policy':['getAuthorizationFailure','ActionValidationError','ClientVisibleError'],
 'reactive-state-and-stores':['State','Store','ClientState','ClientStore','Computed','createStore','connectStore'],
 'scoped-services-and-injection':['Service','ServiceScope','DIContainer'],
 'optimistic-edits-and-uncertain-rpc':['Optimistic','optimistic','isUncertainRpcError'],
 'rpc-streams-and-transport-policy':['rpc$','evaluateTransportCapability'],
 'accessible-form-controller':['createFormController','createFormBindings'],
 'authorized-object-storage':['Storage','StorageProvider','validateStorageKey'],
 'image-rendering-diagnostics':['Image','imageDiagnostics'],
 'local-workflow-lifecycle':['defineWorkflow','createLocalWorkflowProvider','createWorkflowClient'],
 'fixed-server-failure-diagnostics':['logRuntimeFailure','RuntimeFailureContext'],
 'runtime-and-counter-guarantees':['InMemoryRateLimitStore','assertStorageRequirements'],
 'template-head-and-browser-ownership':['html','css','createRef','mergeHead'],
 'request-context-and-signed-values':['signValue','verifyValue','generateToken'],
 'navigation-result-ownership':['NavigateResult','NavigateOptions'],
};
async function catalog(){return JSON.parse(await fs.readFile(path.join(repository,'packages/core/agent-docs.json'),'utf8'));}
describe('authored public Core family guides',()=>{
 it('covers coherent families with public imports and honest runtime limits',async()=>{
  const {guides}=await catalog();const manifest=JSON.parse(await fs.readFile(path.join(repository,'packages/core/package.json'),'utf8'));
  const exports=Object.keys(manifest.exports).map(subpath=>({subpath,import:subpath.replace('.',manifest.name),targets:[{status:'present'}]}));
  const guidance=await readPackageGuidance(path.join(repository,'packages/core'),manifest.name,manifest.version,exports);expect(guidance.status).toBe('available');expect(guidance.guides).toHaveLength(guides.length);
  expect(new Set(guides.map(guide=>guide.id)).size).toBe(guides.length);
  for(const [id,symbols] of Object.entries(coverage)){
   const guide=guides.find(candidate=>candidate.id===id);expect(guide,id).toBeDefined();
   expect(guide.summary.length).toBeGreaterThan(30);expect(guide.markdown.length).toBeGreaterThan(300);expect(guide.examples).toHaveLength(1);
   const source=guide.examples[0].source;
   for(const symbol of symbols)expect(source,id+' '+symbol).toContain(symbol);
   const imports=[...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match=>match[1]);
   expect(imports.length,id).toBeGreaterThan(0);
   expect([...new Set(imports)].sort()).toEqual([...guide.imports].sort());
   for(const name of imports){expect(name).toMatch(/^@cossackframework\/core(?:\/[^/]+)?$/);expect(manifest.exports[name.replace('@cossackframework/core','.')]).toBeDefined();}
   expect(source).not.toMatch(/\bas any\b|@ts-ignore|\/src\/|\/dist\//);
  }
  const workflow=guides.find(guide=>guide.id==='local-workflow-lifecycle');
  for(const phrase of ['process-only','SVC-04 native acceptance is complete at its recorded composite scope','Native persisted local lifecycle acceptance proves retry effects, pause, process restart','Actual hosted Cloudflare acceptance separately proves literal Waiting','Miniflare provider does not prove literal Waiting','example as native restart or hosted Waiting evidence'])expect(workflow.markdown).toContain(phrase);
  expect(workflow.markdown).not.toContain('acceptance remains open');
  for(const id of ['reactive-state-and-stores','optimistic-edits-and-uncertain-rpc','navigation-result-ownership'])expect(guides.find(guide=>guide.id===id).markdown).toMatch(/not.*(?:prove|run|call)|does not/);
 });
 it('strictly compiles and executes new portable examples against public workspace packages',async()=>{
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-core-guides-'));
  try{
   await linkRepositoryModules(scratch,{packages:['core','renderer'],includeHidden:true});
   await fs.writeFile(path.join(scratch,'package.json'),' {"type":"module"}');
   const {guides}=await catalog();const files=[];
   for(const guide of guides.filter(guide=>Object.hasOwn(coverage,guide.id))){const file=path.join(scratch,guide.id+'.ts');await fs.writeFile(file,guide.examples[0].source);files.push(file);}
   await fs.writeFile(path.join(scratch,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',strict:true,noEmitOnError:true,experimentalDecorators:true,emitDecoratorMetadata:true,skipLibCheck:true,types:[],lib:['ES2022','DOM','DOM.Iterable'],outDir:path.join(scratch,'compiled')},files}));
   await execute(process.execPath,[path.join(repository,'node_modules/typescript/bin/tsc'),'-p',path.join(scratch,'tsconfig.json')],{cwd:scratch,timeout:60000}).catch(error=>{throw new Error(String(error.stdout)+String(error.stderr),{cause:error});});
   for(const file of files){const result=await execute(process.execPath,[path.join(scratch,'compiled',path.basename(file,'.ts')+'.js')],{cwd:scratch,timeout:10000});expect(result.stderr).toBe('');}
  }finally{await fs.rm(scratch,{recursive:true,force:true});}
 },90000);
});
