import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildEffectiveRouteModel } from '../src/scan-routes.js';
import { writeNavigationOwnershipAcceptance } from './fixtures/navigation-ownership-acceptance.js';

const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
it('inspects the same nested service declarations exercised by production runtime ownership acceptance',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-rt12-ownership-'));roots.push(root);
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));
  await writeNavigationOwnershipAcceptance(root);
  const model=await buildEffectiveRouteModel(root);
  const expected=new Map([
    ['/src/pages/probe/layout.ts',['ProbeService','ProbeSibling']],
    ['/src/pages/probe/nested/layout.ts',['ProbeService']],
  ]);
  for(const [filePath,names] of expected){
    const layout=model.layouts.find(layout=>layout.filePath===filePath);
    expect(layout.serviceOwnership.status).toBe('resolved');
    expect(layout.serviceOwnership.services.map(service=>service.className)).toEqual(names);
    for(const service of layout.serviceOwnership.services){
      expect(service).toMatchObject({source:'/src/OwnershipProbe.ts',serviceDecorator:'declared'});
      expect(service.line).toBeGreaterThan(0);
    }
  }
  const page=model.pages.find(page=>page.filePath==='/src/pages/probe/nested/index.ts');
  expect(page.layouts).toEqual(['/src/pages/layout.ts',...expected.keys()]);
});
