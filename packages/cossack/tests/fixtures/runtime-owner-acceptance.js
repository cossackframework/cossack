import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

// Route one browser origin to real built runtimes. SSR metadata is untouched.
export async function createRuntimeProxy(initialOrigin) {
  let target = initialOrigin;
  const server = createServer(async (request, response) => {
    try {
      if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const upstream = await fetch(new URL(request.url,target), {method:request.method});
      response.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([key])=>!['content-encoding','content-length','transfer-encoding'].includes(key))));
      if (upstream.body) {
        const body = Readable.fromWeb(upstream.body);
        response.on('close',()=>body.destroy()); body.on('error',()=>response.destroy()); body.pipe(response);
      } else response.end();
    } catch { if (!response.headersSent) response.writeHead(502); response.end(); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:'http://127.0.0.1:'+server.address().port,select:origin=>{target=origin;},
    close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}

export async function checkRuntimeOwnership(browser, proxy, nodeOrigin, workerOrigin) {
  const page=await browser.newPage();
  const fields=['root-draft','root-service','root-child','layout-draft','layout-service','layout-child','page-draft','page-child'];
  const ids=async()=>[await page.locator('#root-service-id').textContent(),await page.locator('#layout-service-id').textContent()];
  try {
    await page.goto(proxy.origin+'/owner?viewer=runtime&space=one&revision=1');
    await browserExpect.poll(()=>page.evaluate(()=>window.__cossackReady)).toBe(true);
    const nodeRuntime=await page.evaluate(()=>window.__INITIAL_STATE__.runtime);
    expect(nodeRuntime.adapter).toBe('node');
    let oldIds=await ids();
    for (const [index,origin] of [workerOrigin,nodeOrigin].entries()) {
      for(const id of fields) await page.locator('#'+id).fill('private '+id);
      const oldRuntime=await page.evaluate(()=>window.__INITIAL_STATE__.runtime);
      proxy.select(origin);
      expect(await page.evaluate(async revision=>(await window.__ownershipApp.navigate('/owner?viewer=runtime&space=one&revision='+revision)).outcome,index+2)).toBe('completed');
      const runtime=await page.evaluate(()=>window.__INITIAL_STATE__.runtime);
      expect(runtime).not.toEqual(oldRuntime);
      if(index===1) expect(runtime).toEqual(nodeRuntime);
      for(const id of fields) await browserExpect(page.locator('#'+id)).toHaveValue('');
      for(const level of ['root','layout','page']) await browserExpect(page.locator('#'+level+'-user')).toHaveText('runtime');
      const nextIds=await ids();
      expect(nextIds[0]).not.toBe(oldIds[0]); expect(nextIds[1]).not.toBe(oldIds[1]);
      for(const id of oldIds) await browserExpect.poll(()=>page.evaluate(marker=>(window.__ownershipDisposals??[]).filter(value=>value===marker).length,id)).toBe(1);
      oldIds=nextIds;
    }
  } finally { await page.close(); }
}
