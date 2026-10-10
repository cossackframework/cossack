import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, addFeature, readManifest, resolveRecipe, recipeCapabilityRequirements } from '../src/index.js';
const temporary=[];async function directory(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-workflow-recipes-'));temporary.push(root);return root;}
afterEach(async()=>{await Promise.all(temporary.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
async function snapshot(root){const manifest=await readManifest(root);return Object.fromEntries(await Promise.all(Object.keys(manifest.files).sort().map(async file=>[file,await fs.readFile(path.join(root,file),'utf8')])));}
it('generates native Workflow setup with equivalent create/add and idempotent preserved application files',async()=>{
 const direct=await createApp('app',{cwd:await directory(),adapter:'cloudflare',preset:'minimal',features:['workflows'],interactive:false});
 const composed=await createApp('app',{cwd:await directory(),adapter:'cloudflare',preset:'minimal',interactive:false});await addFeature(composed.projectDir,'workflows',{interactive:false});
 expect(await snapshot(composed.projectDir)).toEqual(await snapshot(direct.projectDir));
 const config=JSON.parse(await fs.readFile(path.join(direct.projectDir,'wrangler.jsonc'),'utf8'));expect(config.workflows).toEqual([{name:'app-approval',binding:'WORKFLOWS',class_name:'ApprovalWorkflow'}]);
 expect(await fs.readFile(path.join(direct.projectDir,'src/index.ts'),'utf8')).toContain("export { ApprovalWorkflow } from './workflows/entry'");
 expect(await fs.readFile(path.join(direct.projectDir,'vite.config.ts'),'utf8')).toContain('cossackWorkflows()');
 const file=path.join(composed.projectDir,'src/workflows/approval.ts');const authored=(await fs.readFile(file,'utf8'))+'\n// application-owned';await fs.writeFile(file,authored);await addFeature(composed.projectDir,'workflows',{interactive:false});expect(await fs.readFile(file,'utf8')).toBe(authored);
});
it.each(['node'])('rejects native Workflow recipe on %s before writing',async adapter=>{
 const root=await directory();await expect(createApp('app',{cwd:root,adapter,preset:'minimal',features:['workflows'],interactive:false})).rejects.toThrow();expect(await fs.readdir(root)).toEqual([]);
});
it('declares the required Workflow binding without claiming remote readiness',()=>{const recipe=resolveRecipe({adapter:'cloudflare',preset:'minimal',features:['workflows']});expect(recipeCapabilityRequirements(recipe)).toContainEqual(expect.objectContaining({feature:'workflows/cloudflare',requires:{cloudflareBindings:['WORKFLOWS']}}));});
