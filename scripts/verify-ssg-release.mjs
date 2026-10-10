import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root=await fs.realpath(process.argv[2]);
const source=path.join(root,'src/pages/release-ssg/index.ts');
await assert.rejects(fs.access(source),'Acceptance fixture path must be unused.');
await fs.mkdir(path.dirname(source),{recursive:true});
try {
 await fs.writeFile(source,`import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
@Page({ssg:true,transport:'http'})export default class ReleasePage extends Cossack{render(){return html\`<main>Installed SSG release acceptance</main>\`;}}`);
 await promisify(execFile)('pnpm',['exec','vite','build'],{cwd:root,env:{...process.env,VITEST:'',WRANGLER_SEND_METRICS:'false'},timeout:120000,maxBuffer:4*1024*1024});
 const out=path.join(root,'dist/client');
 const html=await fs.readFile(path.join(out,'release-ssg/index.html'),'utf8');
 assert.ok(html.includes('Installed SSG release acceptance'));
 assert.ok(html.includes('window.__INITIAL_STATE__'));
 const scripts=[...html.matchAll(/src=["']([^"']+\.js)["']/g)].map(match=>match[1]);
 assert.ok(scripts.length>0,'Static page must reference real client assets.');
 for(const asset of scripts)await fs.access(path.join(out,asset));
 const sitemap=await fs.readFile(path.join(out,'sitemap.xml'),'utf8');
 assert.match(sitemap,/<loc>https?:\/\/[^<]+\/release-ssg<\/loc>/);
 const report=JSON.parse(await fs.readFile(path.join(out,'cossack-ssg-report.json'),'utf8'));
 assert.equal(report.version,1);
 assert.ok(report.outcomes.some(item=>item.routePath==='/release-ssg'&&item.status==='rendered'&&item.sourceFile==='/src/pages/release-ssg/index.ts'));
 await fs.access(path.join(root,'dist/ssr/wrangler.json'));
 console.log('Installed generated Cloudflare Vite/Wrangler SSG HTML, hydration assets, sitemap and route report passed.');
}finally{await fs.rm(path.dirname(source),{recursive:true,force:true});}
