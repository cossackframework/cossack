import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSync } from 'vite';
import { createRequire } from 'node:module';
import { createApp } from '@cossackframework/scaffold';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { writeMarkdownReleaseAcceptance, checkMarkdownReleaseOutputs } from './fixtures/markdown-release-acceptance.js';

const execute=promisify(execFile);
async function project() {
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-markdown-release-'));
  let root;
  const installedRoot=process.env.COSSACK_MARKDOWN_INSTALLED_ROOT;
  if(installedRoot) {
    ({projectDir:root}=await createApp('app',{cwd:parent,adapter:'node',preset:'minimal',features:['markdown'],interactive:false}));
    const gate=JSON.parse(await fs.readFile(path.join(installedRoot,'package.json'),'utf8'));
    const overrides=Object.fromEntries(Object.entries({...gate.dependencies,...gate.devDependencies}).filter(([name,value])=>(name.startsWith('@cossackframework/')||name==='cossack')&&typeof value==='string'&&value.startsWith('file:')));
    const manifestFile=path.join(root,'package.json');const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
    manifest.pnpm={...manifest.pnpm,overrides};await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
    await fs.writeFile(path.join(root,'pnpm-workspace.yaml'),'overrides:\n'+Object.entries(overrides).map(([name,value])=>`  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n')+'\n');
    await execute('pnpm',['install','--ignore-scripts','--config.strict-dep-builds=false'],{cwd:root,timeout:120000,maxBuffer:8*1024*1024});
    for(const name of ['core','renderer','framework'])expect((await fs.realpath(path.join(root,'node_modules/@cossackframework',name))).startsWith(root+path.sep),'installed '+name+' must resolve inside fresh application').toBe(true);
  }else root=await scaffoldLinkedApp(parent,{adapter:'node',features:['markdown'],packages:['framework','core','renderer','node-adapter','auth','database','ui']});
  return {root,parent};
}

function projectTool(root,packageName,relative) {const require=createRequire(path.join(root,'package.json'));return path.join(path.dirname(require.resolve(packageName+'/package.json')),relative);}

async function build(root) {
  try {return {success:true,...await execute(process.execPath,[projectTool(root,'vite','bin/vite.js'),'build'],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:''},timeout:120000,maxBuffer:4*1024*1024})};}
  catch(error){return {success:false,stdout:error.stdout??'',stderr:error.stderr??''};}
}

async function staticHtml(root) {
  const files=[];const visit=async directory=>{for(const entry of await fs.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else if(entry.name.endsWith('.html'))files.push(file);}};
  await visit(path.join(root,'dist/client'));return files;
}

it('writes parseable generated Markdown locale and contract fixture sources',async()=>{
  const {root,parent}=await project();
  try {await writeMarkdownReleaseAcceptance(root);const visit=async directory=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else if(entry.name.endsWith('.ts'))expect(parseSync(file,await fs.readFile(file,'utf8'),{lang:'ts'}).errors,file).toEqual([]);}};await visit(path.join(root,'src'));expect(parseSync('frontmatter-contract.ts',await fs.readFile(path.join(root,'frontmatter-contract.ts'),'utf8'),{lang:'ts'}).errors).toEqual([]);}
  finally {await fs.rm(parent,{recursive:true,force:true});}
},180000);

it('builds mixed localized Markdown/TypeScript output, aliases and typed extension metadata',async()=>{
  const {root,parent}=await project();
  try {
    await writeMarkdownReleaseAcceptance(root);
    await execute(process.execPath,[projectTool(root,'typescript','bin/tsc'),'--ignoreConfig','--noEmit','--skipLibCheck','--strict','--module','ESNext','--moduleResolution','Bundler','--target','ESNext','frontmatter-contract.ts'],{cwd:root,timeout:30000,maxBuffer:1024*1024});
    const result=await build(root);expect(result.success,result.stdout+'\n'+result.stderr).toBe(true);await checkMarkdownReleaseOutputs(root);
  }finally{await fs.rm(parent,{recursive:true,force:true});}
},180000);

it.each(['metadata','mixed','parameters','alias'])('rejects %s before publishing static content',async failure=>{
  const {root,parent}=await project();
  try {
    await writeMarkdownReleaseAcceptance(root,{failure});const result=await build(root);
    expect(result.success,'invalid '+failure+' must fail build').toBe(false);
    expect(await staticHtml(root),'failed preflight must not publish selected pages').toEqual([]);
    const diagnostics=result.stdout+'\n'+result.stderr;
    if(failure==='metadata'){expect(diagnostics).toContain('invalid.md');expect(diagnostics).not.toContain('PRIVATE_MARKDOWN_METADATA_VALUE');}
    else expect(diagnostics).toMatch(/collision|duplicate|conflict|COSSACK_SSG_DUPLICATE_OUTPUT/i);
  }finally{await fs.rm(parent,{recursive:true,force:true});}
},180000);
