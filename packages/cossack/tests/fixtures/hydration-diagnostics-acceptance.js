import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

export async function writeHydrationDiagnosticsAcceptance(root) {
  const write=async(file,source)=>{const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source);};
  await write('src/HydrationService.ts', `import {CossackService,Service,State} from '@cossackframework/core';
    export let resourceLoads=0;export async function loadOnce(){resourceLoads++;return {loaded:true};}
    @Service() export class HydrationService extends CossackService { @State() clicks=0;@State() marker=crypto.randomUUID(); }
  `);
  await write('src/components/HydrationChild.ts', `import {Cossack,State} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
    export default class HydrationChild extends Cossack { @State() note='child-default';render(){return html\`<section id="hydration-child"><strong id="child-text">hyd-text-baseline</strong><span>\${this.note}</span></section>\`;} }
  `);
  await write('src/components/ClientOnlyChild.ts', `import {Cossack} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
    export default class ClientOnlyChild extends Cossack {
      get hydrationMetadata(){return {...super.hydrationMetadata,expectedClientOnly:true};}
      render(){return html\`<p id="client-only">\${typeof window==='undefined'?'client-only-server-private':'client-only-browser-private'}</p>\`;}
    }
  `);
  await write('src/pages/hydration/layout.ts' , `import {Cossack,Page,Inject} from '@cossackframework/core';import {html} from '@cossackframework/renderer';import {HydrationService} from '../../HydrationService';
    @Page({transport:'http',services:[HydrationService]})export default class HydrationLayout extends Cossack { @Inject(HydrationService)service!:HydrationService;
      render(){return html\`<aside><span id="hydration-service">\${this.service.clicks}</span><span id="hydration-marker">\${this.service.marker}</span></aside>\${this.children}\`;} }
  `);
  const pageSource=name=>`import {Cossack,Page,State,Inject,server$} from '@cossackframework/core';import {html,component} from '@cossackframework/renderer';
    import {HydrationService,loadOnce} from '../../HydrationService';import HydrationChild from '../../components/HydrationChild';import ClientOnlyChild from '../../components/ClientOnlyChild';
    @Page({transport:'http'})export default class ${name} extends Cossack { @State() count=2; @Inject(HydrationService)service!:HydrationService;
      loaded=server$(async()=>loadOnce(),{initial:{loaded:false}});
      render(){return html\`<main id="hydration-main"><h1>Hydration acceptance</h1><span id="hydration-loaded">\${this.loaded.loaded}</span><span id="hydration-count">\${this.count}</span>
      <button id="hydration-click" @click=\${()=>{this.count++;this.service.clicks++;}}>Click once</button>
      \${component(HydrationChild)}\${component(ClientOnlyChild)}<a id="hydration-next" href="/hydration/next">Next</a></main>\`;}
    }`;
  await write('src/pages/hydration/index.ts',pageSource('HydrationPage'));
  await write('src/pages/hydration/next.ts',pageSource('HydrationNext'));
  await write('src/pages/api/hydration-loads.ts', `import {resourceLoads} from '../../HydrationService';export const GET=(c:any)=>c.json({loads:resourceLoads});`);
}

export async function checkHydrationDiagnosticsAcceptance(browser,origin,{production=false}={}) {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__hydrationEvents=[];
    const warn=console.warn;console.warn=(...args)=>{for(const value of args)if(value&&typeof value==='object'&&value.event==='cossack.hydration.mismatch')window.__hydrationEvents.push(value);warn(...args);};
  });
  try {
    let mode='valid';
    await page.route('**/hydration',async route=>{
      const response=await route.fetch();let body=await response.text();
      if(mode==='text')body=body.replace('hyd-text-baseline','hyd-text-private-value');
      if(mode==='structure')body=body.replace(/<strong\s+id=(?:"child-text"|child-text)>/, '<em id="child-text">').replace('</strong>','</em>');
      if(mode==='state')body=body.replace(/"public":\{"count":2/, '"public":{"count":"HYDRATION_PRIVATE_STATE_VALUE"');
      body=body.replace('</body>','<script>window.__ssrHydrationButton=document.getElementById("hydration-click");window.__ssrHydrationChild=document.getElementById("hydration-child");</script></body>');
      await route.fulfill({response,body});
    });
    const load=async()=>{await page.goto(origin+'/hydration');await page.waitForFunction(()=>window.__cossackReady===true);};
    const loads=async()=>{const response=await fetch(origin+'/api/hydration-loads');expect(response.status,'resource audit endpoint status').toBe(200);expect(response.headers.get('content-type'),'resource audit endpoint MIME').toContain('application/json');return (await response.json()).loads;};
    const before=await loads();
    await load();
    const retained=await page.evaluate(()=>({button:window.__ssrHydrationButton===document.getElementById('hydration-click'),child:window.__ssrHydrationChild===document.getElementById('hydration-child'),events:window.__hydrationEvents}));
    expect(retained,JSON.stringify(retained)).toMatchObject({button:true,child:true});
    expect(await page.evaluate(()=>window.__hydrationEvents)).toEqual([]);
    await browserExpect(page.locator('#client-only')).toHaveText('client-only-browser-private');
    await browserExpect(page.locator('#hydration-loaded')).toHaveText('true');
    expect(await loads()-before).toBe(1);
    await page.locator('#hydration-click').click();
    await browserExpect(page.locator('#hydration-count')).toHaveText('3');
    await browserExpect(page.locator('#hydration-service')).toHaveText('1');
    expect(await page.evaluate(()=>window.__hydrationEvents)).toEqual([]);
    const marker=await page.locator('#hydration-marker').textContent();
    await page.locator('#hydration-next').click();
    await browserExpect(page).toHaveURL(/\/hydration\/next$/);
    await browserExpect(page.locator('#hydration-service')).toHaveText('1');
    expect(await page.locator('#hydration-marker').textContent()).toBe(marker);
    expect(await page.evaluate(()=>window.__hydrationEvents)).toEqual([]);
    for(mode of ['text','structure','state']) {
      await load();
      const events=await page.evaluate(()=>window.__hydrationEvents);
      if(production)expect(events).toEqual([]);
      else {
        expect(events.length,mode+' mismatch must report').toBeGreaterThan(0);
        if(mode==='text')expect(events.some(event=>event.category==='text-content')).toBe(true);
        if(mode==='structure')expect(events.some(event=>event.category==='element-tag')).toBe(true);
        if(mode==='state')expect(events.some(event=>event.category==='state-type')).toBe(true);
        expect(events.some(event=>typeof event.component==='string'&&event.source?.file)).toBe(true);
        if(mode==='state')expect(events.some(event=>event.statePath==='public.count'&&event.expected==='number'&&event.actual==='string')).toBe(true);
      }
      const encoded=JSON.stringify(events);
      expect(encoded).not.toContain('hyd-text-private-value');expect(encoded).not.toContain('HYDRATION_PRIVATE_STATE_VALUE');
    }
    expect(errors).toEqual([]);
  } finally {await page.close();}
}

export async function checkHydrationProductionArtifacts(root) {
  const sourceRoot=root.replaceAll('\\','/');
  const visit=async directory=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else if(/\.(?:js|html)$/.test(entry.name)){const source=await fs.readFile(file,'utf8');expect(source.includes(sourceRoot),file+' contains an absolute project path').toBe(false);expect(source.includes('cossack.hydration.mismatch'),file+' contains hydration diagnostic code').toBe(false);expect(source.includes('__source'),file+' contains development source metadata: '+source.slice(Math.max(0,source.indexOf('__source')-70),source.indexOf('__source')+80)).toBe(false);}}};
  await visit(path.join(root,'dist/client'));
}
