import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

export async function writeTestUtilitiesAcceptance(root) {
  const write=async(file,source)=>{const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source);};
  await write('src/bootstrap/middlewares.ts', `export default [async(c,next)=>{
    const viewer=c.req.header('x-fixture-user')??c.req.query('viewer');
    if(viewer)c.set('user',{id:viewer});c.set('utility.request',crypto.randomUUID());await next();
  }];`);
  await write('src/UtilityService.ts', `import {CossackService,Service,Server} from '@cossackframework/core';
    export const audit:Array<{viewer:string|undefined,request:string,marker:string}>=[];
    @Service() export class UtilityService extends CossackService {
      marker=crypto.randomUUID();
      @Server() async snapshot(){const before={viewer:this.user?.id,request:this.c.get('utility.request' as any),marker:this.marker};
        await new Promise(resolve=>setTimeout(resolve,15));return {before,after:{viewer:this.user?.id,request:this.c.get('utility.request' as any),marker:this.marker}};}
      async onDispose(){if(typeof window!=='undefined')return;await new Promise(resolve=>setTimeout(resolve,15));
        audit.push({viewer:this.user?.id,request:this.c.get('utility.request' as any),marker:this.marker});}
    }
  `);
  await write('src/pages/helper/layout.ts', `import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';import {UtilityService} from '../../UtilityService';
    @Page({transport:'http',services:[UtilityService]})export default class Layout extends Cossack {render(){return html\`\${this.children}\`;}}`);
  await write('src/pages/helper/index.ts', `import {Cossack,Page,Server,State,Inject} from '@cossackframework/core';import {html} from '@cossackframework/renderer';import {UtilityService} from '../../UtilityService';
    @Page({transport:'http'})export default class UtilityPage extends Cossack {
      @State() count=2;@Inject(UtilityService)service!:UtilityService;
      @Server({authorize:(_input,{context})=>context.get('user')?.id==='alice'})async increment(){
        const serverOnly='PRIVATE_TEST_UTILS_SERVER_SENTINEL';if(!serverOnly)throw Error();this.count++;return {count:this.count,viewer:this.user?.id};}
      render(){return html\`<main><span id="utility-count">\${this.count}</span><button id="utility-increment" @click=\${()=>this.increment()}>Increment</button></main>\`;}
    }`);
  await write('src/pages/api/utility-audit.ts', `import {audit} from '../../UtilityService';export const GET=(c:any)=>c.json(audit);`);
}
export async function checkTestUtilitiesAcceptance(browser,origin,root) {
  const {createServerApp,authFixture,readHydrationState}=await import((await promisify(execFile)(process.execPath,['--input-type=module','-e',"process.stdout.write(import.meta.resolve('@cossackframework/test-utils/server'))"],{cwd:root})).stdout);
  const app=createServerApp({fetch:request=>fetch(request),env:{},baseUrl:origin});
  const credentials=viewer=>authFixture({headers:{'x-fixture-user':viewer}});
  const html=await(await app.request('/helper',credentials('alice'))).text();
  const hydration=readHydrationState(html);
  expect(hydration).toBeTruthy();expect(hydration.public.count).toBe(2);
  const id=hydration.componentRouteId;
  const denied=await app.componentRpc({componentRouteId:id,action:'increment',state:hydration.public},credentials('bob'));
  expect(denied.status).toBe(403);
  const accepted=await app.componentRpc({componentRouteId:id,action:'increment',state:hydration.public},credentials('alice'));
  expect(accepted.status,await accepted.clone().text()).toBe(200);
  expect((await accepted.json())._cossack_return).toEqual({count:3,viewer:'alice'});
  const manifest=await(await app.request('/cossack-routes.json')).json();
  const ownerRouteId=manifest.filePathToId['/src/pages/helper/layout.ts'];
  const snapshots=await Promise.all(['alice','bob'].map(async viewer=>{
    const response=await app.serviceRpc({ownerRouteId,slot:'0',action:'snapshot'},credentials(viewer));
    expect(response.status,await response.clone().text()).toBe(200);return (await response.json())._cossack_return;
  }));
  const audit=await(await app.request('/api/utility-audit')).json();
  snapshots.forEach(({before,after},index)=>{
    expect(after).toEqual(before);expect(before.viewer).toBe(['alice','bob'][index]);
    expect(audit.filter(entry=>entry.marker===before.marker)).toHaveLength(1);
  });
  expect(snapshots[0].before.request).not.toBe(snapshots[1].before.request);
  const page=await browser.newPage();
  try {await page.goto(origin+'/helper?viewer=alice');
    await browserExpect.poll(()=>page.evaluate(()=>window.__cossackReady)).toBe(true);
    await browserExpect(page.locator('#utility-count')).toHaveText('2');
    await page.locator('#utility-increment').click();await browserExpect(page.locator('#utility-count')).toHaveText('3');
  } finally {await page.close();}
  const inspect=async directory=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);if(entry.isDirectory())await inspect(file);
    else if(/\.(?:js|map)$/.test(file))expect(await fs.readFile(file,'utf8')).not.toContain('PRIVATE_TEST_UTILS_SERVER_SENTINEL');
  }};await inspect(path.join(root,'dist/client'));
}
