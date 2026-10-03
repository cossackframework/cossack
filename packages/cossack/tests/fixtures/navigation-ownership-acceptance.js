import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

export async function writeNavigationOwnershipAcceptance(root) {
  const write = async (file, code) => {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, code);
  };
  // Test-only identity source. This is not an authentication example.
  await write('src/bootstrap/middlewares.ts', `export default [async(c,next)=>{
    c.set('user',{id:c.req.query('viewer')??'alice'});await next();
  }];`);
  await write('src/Ownership.ts', `
    import {Cossack,CossackService,Service,State,ClientStore,Client} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    @Service() export class RootService extends CossackService {
      marker=crypto.randomUUID(); open=true; @State() text='';
      @Client() onDispose(){this.open=false;((window as any).__ownershipDisposals??=[]).push(this.marker);}
    }
    @Service() export class LayoutService extends CossackService {
      marker=crypto.randomUUID(); @State() text='';
      @Client() onDispose(){((window as any).__ownershipDisposals??=[]).push(this.marker);}
    }
    export class Child extends Cossack {
      props={slot:''}; @ClientStore() draft={text:''};
      render(){return html\`<input id=\${this.props.slot} .value=\${this.draft.text}
        @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>\`;}
    }
  `);
  await write('src/App.ts', `
    import {Cossack,Page,ClientStore,Client} from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';import {Child} from './Ownership';
    @Page({transport:'http'}) export class App extends Cossack {
      @ClientStore() draft={text:''};
      @Client() onMount(){(window as any).__ownershipApp=this;}
      render(){
        if(!this.isServer && this.c.req.query('space')==='broken') throw new Error('deliberate root failure');
        if(this.c.req.query('space')==='empty') return null;
        return html\`<header><span id="root-user">\${this.user?.id}</span>
        <input id="root-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        \${component(Child,{slot:'root-child'})}</header>\${this.children}\`;}
    }
  `);
  await write('src/pages/layout.ts', `
    import {Cossack,Page,Inject} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';import {RootService} from '../Ownership';
    @Page({transport:'http',services:[RootService]}) export default class RootLayout extends Cossack {
      @Inject(RootService) service!:RootService;
      async onCleanup(){
        if(this.isServer || (window as any).__holdOwnerCleanup!==this.service.marker)return;
        await new Promise<void>(resolve=>{(window as any).__releaseOwnerCleanup=resolve;});
        ((window as any).__ownershipCleanup??=[]).push({marker:this.service.marker,open:this.service.open,
          space:this.c.req.query('space'),viewer:this.user?.id});
      }
      render(){return html\`<section><span id="root-service-id">\${this.service.marker}</span>
        <input id="root-service" .value=\${this.service.text} @input=\${(event:Event)=>{this.service.text=(event.target as HTMLInputElement).value;}}>
        \${this.children}</section>\`;}
    }
  `);
  await write('src/pages/owner/layout.ts', `
    import {Cossack,Page,ClientStore,Inject} from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';import {LayoutService,Child} from '../../Ownership';
    @Page({transport:'http',services:[LayoutService]}) export default class Layout extends Cossack {
      @Inject(LayoutService) service!:LayoutService; @ClientStore() draft={text:''};
      render(){return html\`<section><span id="layout-user">\${this.user?.id}</span><span id="layout-service-id">\${this.service.marker}</span>
        <input id="layout-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        <input id="layout-service" .value=\${this.service.text} @input=\${(event:Event)=>{this.service.text=(event.target as HTMLInputElement).value;}}>
        \${component(Child,{slot:'layout-child'})}\${this.children}</section>\`;}
    }
  `);
  await write('src/pages/owner/index.ts', `
    import {Cossack,Page,ClientStore} from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';import {Child} from '../../Ownership';
    @Page({transport:'http',scope:c=>'space:'+(c.req.query('space')??'one')}) export default class Owner extends Cossack {
      @ClientStore() draft={text:''};
      render(){return html\`<main><span id="page-user">\${this.user?.id}</span>
        <input id="page-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        \${component(Child,{slot:'page-child'})}</main>\`;}
    }
  `);
}

export async function checkNavigationOwnershipBrowser(browser, origin) {
  const page = await browser.newPage();
  const fields = ['root-draft','root-service','root-child','layout-draft','layout-service','layout-child','page-draft','page-child'];
  const navigate = (viewer, space, revision) => page.evaluate(async ({viewer,space,revision}) => {
    return (await window.__ownershipApp.navigate('/owner?'+new URLSearchParams({viewer,space,revision}))).outcome;
  }, {viewer,space,revision});
  const fill = async label => { for (const id of fields) await page.locator('#'+id).fill(label+' '+id); };
  const check = async label => { for (const id of fields) await browserExpect(page.locator('#'+id)).toHaveValue(label ? label+' '+id : ''); };
  const ids = async () => [await page.locator('#root-service-id').textContent(),await page.locator('#layout-service-id').textContent()];
  try {
    await page.goto(origin+'/owner?viewer=alice&space=one&revision=1');
    await browserExpect.poll(() => page.evaluate(() => window.__cossackReady)).toBe(true);
    await fill('private'); const first = await ids();
    expect(await navigate('alice','one','2')).toBe('completed');
    await check('private'); expect(await ids()).toEqual(first);
    expect(await page.evaluate(() => window.__ownershipDisposals??[])).toEqual([]);
    const originalUrl = page.url();
    await page.evaluate(() => document.addEventListener('cossack:navigation-error', event => {
      if(event.detail.error?.message==='deliberate root failure') event.preventDefault();
    }));
    expect(await navigate('alice','broken','failure')).toBe('failed');
    expect(page.url()).toBe(originalUrl); await check('private'); expect(await ids()).toEqual(first);
    await page.evaluate(async () => { window.__ownershipApp.draft.text='late failed root'; await window.__ownershipApp.requestUpdate(); });
    await check('private');
    await browserExpect.poll(() => page.evaluate(() => (window.__ownershipDisposals??[]).length)).toBe(2);
    const abandoned = await page.evaluate(() => window.__ownershipDisposals);
    expect(abandoned.some(id => first.includes(id))).toBe(false);
    await page.evaluate(marker => { window.__holdOwnerCleanup=marker; }, first[0]);
    expect(await navigate('alice','two','3')).toBe('completed');
    await check(''); const second = await ids();
    expect(second[0]).not.toBe(first[0]); expect(second[1]).not.toBe(first[1]);
    await browserExpect.poll(() => page.evaluate(() => typeof window.__releaseOwnerCleanup)).toBe('function');
    expect(await page.evaluate(marker => (window.__ownershipDisposals??[]).includes(marker), first[0])).toBe(false);
    await page.evaluate(() => window.__releaseOwnerCleanup());
    await browserExpect.poll(() => page.evaluate(() => window.__ownershipCleanup)).toEqual([
      {marker:first[0],open:true,space:'one',viewer:'alice'},
    ]);
    await browserExpect.poll(() => page.evaluate(() => window.__ownershipDisposals??[])).toEqual(expect.arrayContaining(first));
    await fill('second');
    expect(await navigate('bob','two','4')).toBe('completed');
    await check(''); const third = await ids();
    for (const level of ['root','layout','page']) await browserExpect(page.locator('#'+level+'-user')).toHaveText('bob');
    expect(third[0]).not.toBe(second[0]); expect(third[1]).not.toBe(second[1]);
    await browserExpect.poll(() => page.evaluate(() => window.__ownershipDisposals??[])).toEqual(expect.arrayContaining([...first,...second]));
    const disposed = await page.evaluate(() => window.__ownershipDisposals);
    for (const id of [...abandoned,...first,...second]) expect(disposed.filter(value => value===id)).toHaveLength(1);

    await fill('private before empty');
    expect(await navigate('bob','empty','5')).toBe('completed');
    await browserExpect(page.locator('#root-draft')).toHaveCount(0);
    await browserExpect(page.locator('#page-draft')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('private before empty');
  } finally { await page.evaluate(() => window.__releaseOwnerCleanup?.()).catch(() => {}); await page.close(); }
}
