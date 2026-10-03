import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium, expect as browserExpect } from '@playwright/test';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(new URL('../../framework/package.json',import.meta.url));
const {build}=await import(require.resolve('vite'));

it('pages HTTP data with stable selection, keyboard controls and retained focus', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-table-browser-'));
  let server,browser; const queries=[]; let fail=true;
  try {
    await fs.writeFile(path.join(root,'index.html'),'<html><body><main id="app"></main><script type="module" src="/main.js"></script></body></html>');
    await fs.writeFile(path.join(root,'main.js'), `
import { DataTable } from '@cossackframework/ui';
import { render } from '@cossackframework/renderer';
const table=new DataTable(); let state={page:1,pageSize:2,filter:''},rows=[],rowCount=0,selection=new Set(),loading=false,error=null,ticket=0;
function draw(){
  table.props={caption:'People',rows,rowCount,state,selection,loading,error,
    columns:[{id:'name',header:'Name',key:'name',sortable:true}],getRowId:row=>row.id,rowLabel:row=>row.name,
    pageSizeOptions:[2,4],onStateChange:load,onRetry:()=>load(state),
    onSelectionChange:ids=>{selection=ids;draw();}};
  render(table.render(),document.querySelector('#app'));
  window.snapshot=()=>({state,selected:[...selection].sort(),loading,error});
}
async function load(next){
  state=next;const own=++ticket;loading=true;error=null;draw();
  try {const response=await fetch('/rows?'+new URLSearchParams({page:String(state.page),size:String(state.pageSize),filter:state.filter,direction:state.sort?.direction??''}));
    if(!response.ok)throw new Error('Rows unavailable');const data=await response.json();if(own!==ticket)return;rows=data.rows;rowCount=data.total;
  } catch(failure){if(own!==ticket)return;error=failure.message;}
  if(own===ticket){loading=false;draw();}
}
load(state);
`);
    await build({root,configFile:false,logLevel:'silent',resolve:{alias:{
      '@cossackframework/ui':path.join(repository,'packages/ui/dist/index.js'),
      '@cossackframework/core':path.join(repository,'packages/core/dist/index.js'),
      '@cossackframework/renderer':path.join(repository,'packages/renderer/dist/index.js'),
    }},build:{outDir:'dist',emptyOutDir:true}});
    server=createServer(async(request,response)=>{
      const url=new URL(request.url,'http://localhost');
      if(url.pathname==='/rows'){
        const query=Object.fromEntries(url.searchParams);queries.push(query);
        await new Promise(resolve=>setTimeout(resolve,80));
        if(query.filter==='error'&&fail){fail=false;response.writeHead(503);response.end();return;}
        let data=['Alice','Bob','Carol','Dan','Eve'].map((name,index)=>({id:String(index+1),name}));
        if(query.filter!=='error')data=data.filter(row=>row.name.toLowerCase().includes(query.filter.toLowerCase()));
        if(query.direction==='desc')data.reverse();
        const page=Number(query.page),size=Number(query.size);
        response.setHeader('content-type','application/json');response.end(JSON.stringify({total:data.length,rows:data.slice((page-1)*size,page*size)}));return;
      }
      try {const file=path.join(root,'dist',url.pathname==='/'?'index.html':url.pathname.slice(1));
        response.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');response.end(await fs.readFile(file));
      }catch{response.writeHead(404);response.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await browserExpect(page.getByRole('checkbox',{name:'Select Alice',exact:true})).toBeEnabled();
    const alice=page.getByRole('checkbox',{name:'Select Alice',exact:true});await alice.focus();await page.keyboard.press('Space');
    await browserExpect(alice).toBeChecked();
    const next=page.getByRole('button',{name:'Next page',exact:true});await next.focus();await page.keyboard.press('Enter');
    await browserExpect(page.getByRole('checkbox',{name:'Select Carol',exact:true})).toBeEnabled();
    await browserExpect(next).toBeFocused();
    await page.getByRole('checkbox',{name:'Select Carol',exact:true}).check();
    await page.getByRole('button',{name:'Previous page',exact:true}).click();
    await browserExpect(alice).toBeEnabled();await browserExpect(alice).toBeChecked();
    await page.getByRole('checkbox',{name:'Select visible rows',exact:true}).check();
    await page.getByRole('checkbox',{name:'Select visible rows',exact:true}).uncheck();
    expect(await page.evaluate(()=>window.snapshot().selected)).toEqual(['3']);
    const filter=page.getByRole('searchbox',{name:'Filter rows'});
    await filter.fill('Eve');await browserExpect(page.getByRole('cell',{name:'Eve',exact:true})).toBeVisible();await browserExpect(filter).toBeFocused();
    expect(await page.evaluate(()=>window.snapshot().selected)).toEqual(['3']);
    await filter.fill('unknown');await browserExpect(page.getByRole('status')).toHaveText('No matching rows.');
    await filter.fill('error');await browserExpect(page.getByRole('alert')).toContainText('Rows unavailable');
    await page.getByRole('button',{name:'Retry',exact:true}).click();await browserExpect(page.getByRole('cell',{name:'Alice',exact:true})).toBeVisible();await browserExpect(filter).toBeFocused();
    await filter.fill('');await browserExpect.poll(()=>page.evaluate(()=>window.snapshot().loading)).toBe(false);
    const sort=page.getByRole('button',{name:'Name',exact:true});await sort.focus();await page.keyboard.press('Enter');
    await browserExpect(page.getByRole('columnheader',{name:'Name',exact:true})).toHaveAttribute('aria-sort','ascending');
    await page.keyboard.press('Enter');await browserExpect(page.getByRole('cell',{name:'Eve',exact:true})).toBeVisible();await browserExpect(sort).toBeFocused();
    await page.getByRole('combobox',{name:'Rows per page'}).selectOption('4');
    await browserExpect(page.locator('tbody tr')).toHaveCount(4);
    await next.focus();await page.keyboard.press('Enter');
    await browserExpect(page.locator('tbody tr')).toHaveCount(1);
    await browserExpect(next).toBeFocused();await browserExpect(next).toHaveAttribute('aria-disabled','true');
    const count=queries.length;await page.keyboard.press('Enter');await page.waitForTimeout(150);expect(queries.length).toBe(count);
    expect(queries.some(query=>query.page==='2')).toBe(true);expect(queries.some(query=>query.direction==='desc')).toBe(true);
    expect(queries.some(query=>query.size==='4'&&query.page==='1')).toBe(true);expect(errors).toEqual([]);
  }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
},120000);
