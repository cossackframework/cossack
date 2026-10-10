import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { beginTestReport, writeTestReport, readTestResults, testSourceSnapshot, testTextRedactor } from '../src/test-results-service.js';
const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-test-evidence-'));roots.push(root);await fs.writeFile(path.join(root,'package.json'),'{"name":"fixture"}');return root;}
const producer={name:'vitest',version:'4.1.11'};
async function finish(root, report, patch={}){const result={...report,state:'passed',finishedAt:new Date().toISOString(),after:await testSourceSnapshot(root),...patch};await writeTestReport(root,result);return result;}
it('distinguishes missing, unfinished, matching and changed evidence without running tests',async()=>{
 const root=await fixture();expect((await readTestResults(root)).data.status).toBe('missing');
 const run=await beginTestReport(root,producer,1);expect((await readTestResults(root)).data.freshness.status).toBe('unfinished');
 await finish(root,run);expect((await readTestResults(root)).data.freshness.status).toBe('matches');
 await fs.writeFile(path.join(root,'source.ts'),'export const changed=true');expect((await readTestResults(root)).data.freshness.status).toBe('changed');
});
it('records changed inputs during a run and unknown symlink inputs conservatively',async()=>{
 const root=await fixture(),run=await beginTestReport(root,producer,1);
 await fs.writeFile(path.join(root,'source.ts'),'changed');await finish(root,run);
 expect((await readTestResults(root)).data.freshness.status).toBe('changed-during-run');
 await fs.symlink(path.join(root,'package.json'),path.join(root,'linked.json'));
 expect((await readTestResults(root)).data.freshness.status).toBe('unknown');
});
it('selects the newest started run even when an older run finishes later',async()=>{
 const root=await fixture(),older=await beginTestReport(root,producer,1),newer=await beginTestReport(root,producer,2);
 older.startedAt='2020-01-01T00:00:00.000Z';await finish(root,older);
 expect((await readTestResults(root)).data.report.id).toBe(newer.id);
 expect((await readTestResults(root,{run:older.id})).data.report.state).toBe('passed');
 expect((await readTestResults(root,{run:randomUUID()})).data.status).toBe('missing');
});
it('excludes dependency/generated/secret inputs and reports the fingerprint scope',async()=>{
 const root=await fixture(),run=await beginTestReport(root,producer,0);await finish(root,run);
 for(const directory of ['node_modules','dist','.git']){await fs.mkdir(path.join(root,directory));await fs.writeFile(path.join(root,directory,'changed'),'ignored');}
 await fs.writeFile(path.join(root,'.env.local'),'SECRET=not-recorded');
 const result=await readTestResults(root);expect(result.data.freshness.status).toBe('matches');expect(result.data.freshness.scope).toContain('no environment');
 expect(JSON.stringify(result)).not.toContain('not-recorded');
});
it('does not follow storage links or accept arbitrary paths and copied reports',async()=>{
 const root=await fixture(),outside=await fixture();await fs.symlink(outside,path.join(root,'.vitest'));
 await expect(readTestResults(root)).rejects.toMatchObject({code:'COSSACK_TEST_REPORT_PATH'});
 await expect(beginTestReport(root,producer,1)).rejects.toMatchObject({code:'COSSACK_TEST_REPORT_PATH'});
 await expect(readTestResults(outside,{run:'../../secret'})).rejects.toMatchObject({code:'COSSACK_TEST_RUN_INVALID'});
 await fs.unlink(path.join(root,'.vitest'));const run=await beginTestReport(root,producer,1);await finish(root,run);
 await fs.mkdir(path.join(outside,'.vitest/cossack'),{recursive:true});await fs.copyFile(path.join(root,'.vitest/cossack',run.id+'.json'),path.join(outside,'.vitest/cossack',run.id+'.json'));
 await expect(readTestResults(outside)).rejects.toMatchObject({code:'COSSACK_TEST_REPORT_PROJECT'});
});
it('rejects corrupt/oversized reports and inconsistent successful states',async()=>{
 const root=await fixture(),run=await beginTestReport(root,producer,1),file=path.join(root,'.vitest/cossack',run.id+'.json');
 await expect(finish(root,run,{failedModules:1})).rejects.toMatchObject({code:'COSSACK_TEST_REPORT_INVALID'});
 await fs.writeFile(file,'{"secret":"do-not-echo"');await expect(readTestResults(root)).rejects.toMatchObject({code:'COSSACK_TEST_REPORT_INVALID'});
 await fs.writeFile(file,' '.repeat(2*1024*1024+1));await expect(readTestResults(root)).rejects.toMatchObject({code:'COSSACK_TEST_REPORT_INVALID'});
});
it('redacts credentials from all configured projects without persisting arbitrary failure text',()=>{
 const redact=testTextRedactor({APP_SECRET:'first-private'},{APP_SECRET:'second-private'});
 expect(redact('first-private second-private token=abc Bearer xyz https://u:p@host')).toBe('[REDACTED] [REDACTED] token=[REDACTED] Bearer [REDACTED] https://[REDACTED]@host');
});

it('redacts literal regexp characters without recursively expanding replacement text', () => {
 const redact=testTextRedactor({TOKEN:'a.$&',SECRET:'E',PRIVATE_KEY:'R'});
 expect(redact('a.$& E R')).toBe('[REDACTED] [REDACTED] [REDACTED]');
});
it('rejects linked report files even when reading an explicit UUID', async () => {
 const root=await fixture(),outside=await fixture(),run=await beginTestReport(root,producer,1);
 const file=path.join(root,'.vitest/cossack',run.id+'.json');await fs.rename(file,path.join(outside,'report.json'));await fs.symlink(path.join(outside,'report.json'),file);
 await expect(readTestResults(root,{run:run.id})).rejects.toMatchObject({code:'COSSACK_TEST_REPORT_INVALID'});
});
it('rejects malformed UTF-8 report text rather than accepting replacement characters', async () => {
 const root=await fixture(),run=await beginTestReport(root,producer,1),file=path.join(root,'.vitest/cossack',run.id+'.json');
 await fs.writeFile(file,Buffer.concat([Buffer.from('{"bad":"'),Buffer.from([0xff]),Buffer.from('"}') ]));
 await expect(readTestResults(root)).rejects.toMatchObject({code:'COSSACK_TEST_REPORT_INVALID'});
});

it('keeps interrupted runs distinct and fails explicitly when report storage is full', async () => {
 const root=await fixture(),run=await beginTestReport(root,producer,1);
 await finish(root,run,{state:'interrupted'});
 expect((await readTestResults(root)).data.report.state).toBe('interrupted');
 const content=JSON.parse(await fs.readFile(path.join(root,'.vitest/cossack',run.id+'.json'),'utf8'));
 for(let i=1;i<128;i++){
  const id=randomUUID();await fs.writeFile(path.join(root,'.vitest/cossack',id+'.json'),JSON.stringify({...content,id}));
 }
 await expect(beginTestReport(root,producer,1)).rejects.toMatchObject({code:'COSSACK_TEST_REPORT_LIMIT'});
 expect((await readTestResults(root,{run:run.id})).data.report.state).toBe('interrupted');
});
