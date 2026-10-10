import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

export async function writeRouteBoundaryAcceptance(root) {
  const write = async (file, code) => {
    const absolute = path.join(root, file); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, code);
  };
  const middleware = name => `async(c,next)=>{c.set('boundaryTrace',[...(c.get('boundaryTrace')??[]),'${name}']);await next();}`;
  await write('src/bootstrap/middlewares.ts', `export default [async(c,next)=>{c.set('boundaryTrace',['global']);await next();c.header('X-Boundary-Trace',c.get('boundaryTrace').join(','));}];`);
  for (const [file, name] of [['layout.ts', 'root'], ['(account)/layout.ts', 'group'], ['(account)/users/[id]/layout.ts', 'dynamic']]) {
    await write('src/pages/' + file, `import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
      @Page({middlewares:[${middleware(name)}]}) export default class Layout extends Cossack {render(){return html\`<section>\${this.children}</section>\`;}}`);
  }
  await write('src/pages/index.ts', `import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
    @Page() export default class Home extends Cossack {render(){return html\`<a id="missing-link" href="/users/alice/missing">Missing</a><a id="error-link" href="/users/fail">Error</a>\`;}}`);
  await fs.rm(path.join(root, 'src/pages/index'), { recursive: true, force: true });
  const leaf = async (file, name, fails = false) => write('src/pages/' + file, `
    import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
    @Page({middlewares:[${middleware(name)}]}) export default class Leaf extends Cossack {
      async init(){${fails ? "if(this.c.req.param('id')==='fail')throw new Error('PRIVATE_BOUNDARY_FAILURE');" : ''}}
      render(){return html\`<p>${name}</p>\`;}
    }`);
  await leaf('(account)/users/[id]/index.ts', 'userPage', true);
  await leaf('(account)/dashboard/index.ts', 'dashboard');
  await leaf('users/new/index.ts', 'literalPage');
  await leaf('direct/index.ts', 'directPage');
  await leaf('(account)/direct/index.ts', 'shadowedPage');
  await leaf('(first)/area/one/index.ts', 'firstPage');
  await leaf('(second)/area/two/index.ts', 'secondPage');
  for (const [file, marker, name] of [
    ['404/index.ts', 'ROOT_NOT_FOUND', 'root404'], ['error/index.ts', 'ROOT_ERROR', 'rootError'],
    ['(account)/404/index.ts', 'GROUP_NOT_FOUND', 'group404'], ['(account)/error/index.ts', 'GROUP_ERROR', 'groupError'],
    ['(account)/users/[id]/404/index.ts', 'USER_NOT_FOUND', 'user404'],
    ['users/new/404/index.ts', 'LITERAL_NOT_FOUND', 'literal404'],
    ['(account)/files/[...path]/404/index.ts', 'FILES_NOT_FOUND', 'files404'],
    ['(first)/404/index.ts', 'FIRST_NOT_FOUND', 'first404'], ['(second)/404/index.ts', 'SECOND_NOT_FOUND', 'second404'],
  ]) {
    await write('src/pages/' + file, `
      import {Cossack,Page,State,Client,getRequestContext} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
      @Page({middlewares:[${middleware(name)}]}) class Boundary extends Cossack {
        @State() count=0;@State() parameter='';@State() order='';
        async init(){this.parameter=this.c.req.param('id')??this.c.req.param('path')??'';this.order=(this.c.get('boundaryTrace') as string[]).join(',');
          if((getRequestContext()?.req.param('id')??getRequestContext()?.req.param('path')??'')!==this.parameter)throw new Error('Boundary request scope differs');}
        @Client() increment(){this.count++;}
        render(){return html\`<main><p id="boundary-marker">${marker}</p><p id="boundary-parameter">\${this.parameter}</p>
          <p id="boundary-order">\${this.order}</p><button id="boundary-counter" @click=\${this.increment}>\${this.count}</button></main>\`;}
      } export {Boundary as default};
    `);
  }
  await write('src/pages/(account)/private/layout.ts', `import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
    @Page({middlewares:[async(c,next)=>{c.set('boundaryTrace',[...(c.get('boundaryTrace')??[]),'privateGuard']);
      if(c.req.header('x-boundary-access')!=='yes')return c.text('Boundary access denied',403);await next();}]})
    export default class PrivateLayout extends Cossack{render(){return html\`<section>\${this.children}</section>\`;}}`);
  await write('src/pages/(account)/private/404/index.ts', `import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
    @Page() export default class PrivateBoundary extends Cossack{render(){return html\`<p>PRIVATE_BOUNDARY_CONTENT</p>\`;}}`);
}

export async function checkRouteBoundaryAcceptance(send) {
  const cases = [
    ['/users/%E9%9B%AA%2Fa/missing', 'USER_NOT_FOUND', 'global,root,group,dynamic,user404', '雪/a'],
    ['/dashboard/missing', 'GROUP_NOT_FOUND', 'global,root,group,group404', ''],
    ['/users/new/missing', 'LITERAL_NOT_FOUND', 'global,root,literal404', ''],
    ['/direct/missing', 'ROOT_NOT_FOUND', 'global,root,root404', ''],
    ['/area/one/missing', 'FIRST_NOT_FOUND', 'global,root,first404', ''],
    ['/area/two/missing', 'SECOND_NOT_FOUND', 'global,root,second404', ''],
    ['/area/missing', 'ROOT_NOT_FOUND', 'global,root,root404', ''],
    ['/files/a/%E9%9B%AA/missing', 'FILES_NOT_FOUND', 'global,root,group,files404', 'a/雪/missing'],
    ['/unknown', 'ROOT_NOT_FOUND', 'global,root,root404', ''],
  ];
  const states = [];
  for (const [url, marker, trace, parameter] of cases) {
    const response = await send(url); const body = await response.text();
    expect(response.status, url).toBe(404); expect(body, url).toContain(marker);
    expect(response.headers.get('X-Boundary-Trace'), url).toBe(trace);
    const state = JSON.parse(body.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)[1]);
    expect(state.public.parameter).toBe(parameter); expect(state.public.order).toBe(trace);
    expect(state.componentPath).toBe(state._cossackBoundary.source); expect(state._cossackBoundary.type).toBe('404');
    states.push(state);
  }
  const method = await send('/users/alice', { method: 'POST' }); expect(method.status).toBe(404);
  expect(method.headers.get('X-Boundary-Trace')).toBe('global,root,group,dynamic,userPage,user404');
  const failed = await send('/users/fail'); expect(failed.status).toBe(500); const errorBody = await failed.text();
  expect(errorBody).toContain('GROUP_ERROR'); expect(errorBody).not.toContain('PRIVATE_BOUNDARY_FAILURE');
  expect(failed.headers.get('X-Boundary-Trace')).toBe('global,root,group,dynamic,userPage,groupError');
  const denied = await send('/private/missing'); expect(denied.status).toBe(403); expect(await denied.text()).not.toContain('PRIVATE_BOUNDARY_CONTENT');
  expect(denied.headers.get('X-Boundary-Trace')).toBe('global,root,group,privateGuard');
  const allowed = await send('/private/missing', { headers: { 'x-boundary-access': 'yes' } }); expect(allowed.status).toBe(404);
  expect(await allowed.text()).toContain('PRIVATE_BOUNDARY_CONTENT');
  return states;
}

export async function checkRouteBoundaryBrowser(browser, origin) {
  const page = await browser.newPage();
  try {
    const initial = await page.goto(origin + '/users/alice/missing'); expect(initial.status()).toBe(404);
    await browserExpect(page.locator('#boundary-marker')).toHaveText('USER_NOT_FOUND');
    await page.locator('#boundary-counter').click(); await browserExpect(page.locator('#boundary-counter')).toHaveText('1');
    await page.goto(origin);
    await page.locator('#missing-link').click(); await browserExpect(page.locator('#boundary-marker')).toHaveText('USER_NOT_FOUND');
    expect(new URL(page.url()).pathname).toBe('/users/alice/missing');
    await page.locator('#boundary-counter').click(); await browserExpect(page.locator('#boundary-counter')).toHaveText('1');
    await page.goBack(); await browserExpect(page.locator('#error-link')).toBeVisible();
    await page.locator('#error-link').click(); await browserExpect(page.locator('#boundary-marker')).toHaveText('GROUP_ERROR');
    expect(new URL(page.url()).pathname).toBe('/users/fail');
    await page.locator('#boundary-counter').click(); await browserExpect(page.locator('#boundary-counter')).toHaveText('1');
  } finally { await page.close(); }
}
