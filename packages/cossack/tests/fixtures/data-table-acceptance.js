import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

export async function createDataTableBackend() {
  const reads=[];let failure=false;
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://localhost');
    if(url.pathname!=='/rows'){response.writeHead(404);response.end();return;}
    const query=Object.fromEntries(url.searchParams);reads.push(query);
    if(failure){failure=false;response.writeHead(503);response.end();return;}
    const data=['Alice','Bob','Carol','Dan','Eve'].map((name,index)=>({id:String(index+1),name}));
    const filtered=data.filter(row=>row.name.toLowerCase().includes(query.search.toLowerCase()));
    if(query.direction==='desc')filtered.reverse();
    const page=Number(query.page),size=Number(query.size);
    response.setHeader('content-type','application/json');
    response.end(JSON.stringify({rows:filtered.slice((page-1)*size,page*size),total:filtered.length}));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:`http://127.0.0.1:${server.address().port}`,reads,failNext(){failure=true;},
    close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}

export async function writeDataTableAcceptance(root, origin) {
  const directory=path.join(root,'src/pages/people');await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'index.ts'), `
import { Cossack, Page, Client, ClientState, server$, defineUrlState, url } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { DataTable, type DataTableColumn, type DataTableState } from '@cossackframework/ui';
interface Person { id:string; name:string }
interface Result { rows:Person[]; total:number }
const filters=defineUrlState({ search:url.string(), page:url.integer({default:1,min:1}), size:url.integer({default:2,min:1,max:50}), direction:url.enum(['none','asc','desc']) });
const columns:DataTableColumn<Person>[]=[{id:'name',header:'Name',key:'name',sortable:true}];
@Page({transport:'http'})
export default class People extends Cossack<any,{Resources:'result'}> {
  @ClientState() selectedIds:string[]=[];
  get query(){return this.urlState(filters);}
  result=server$(async(search:string,page:number,size:number,direction:string):Promise<Result>=>{
    if(typeof search!=='string'||!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>50||!['none','asc','desc'].includes(direction))throw new Error('Invalid table query');
    const response=await fetch(${JSON.stringify(origin)}+'/rows?'+new URLSearchParams({search,page:String(page),size:String(size),direction}));
    if(!response.ok)throw new Error('Table backend failed');
    return await response.json() as Result;
  },{initial:{rows:[],total:0} as Result,deps:()=>[this.query.search,this.query.page,this.query.size,this.query.direction] as const});
  @Client() change(state:DataTableState){return this.updateUrlState(filters,{search:state.filter,page:state.page,size:state.pageSize,direction:state.sort?.direction??'none'});}
  @Client() select(ids:Set<string>){this.selectedIds=[...ids];}
  @Client() retry(){return this.refresh$('result');}
  render(){
    const result=this.result;const status=this.resourceStatus$('result');const query=this.query;
    return html\`<main><h1>Server people</h1><button type="button" @click=\${this.retry}>Refresh rows</button><output id="selected">\${this.selectedIds.slice().sort().join(',')}</output>
      \${component(DataTable<Person>,{id:'people',caption:'People',columns,rows:result.rows,rowCount:result.total,
        getRowId:row=>row.id,rowLabel:row=>row.name,pageSizeOptions:[2,4],
        state:{page:query.page,pageSize:query.size,filter:query.search,sort:query.direction==='none'?undefined:{columnId:'name',direction:query.direction}},
        onStateChange:this.change,selection:new Set(this.selectedIds),onSelectionChange:this.select,
        loading:status.state==='pending',error:status.state==='error'?'Rows unavailable':null,onRetry:this.retry})}
    </main>\`;
  }
}
`);
}

export async function checkDataTableBrowser(browser, origin, backend) {
  const copied='/people?page=2';
  const response=await fetch(origin+copied);expect(response.status).toBe(200);
  const source=(await response.text()).replace(/<!--[^]*?-->/g,'');expect(source).toContain('<caption>People</caption>');expect(source).toContain('Carol');
  expect(backend.reads).toHaveLength(1);
  const page=await browser.newPage();const errors=[],rpc=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).pathname==='/crpc')rpc.push(request);});
  const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  try{
    await page.goto(origin+copied);
    await page.waitForFunction(()=>window.__cossackReady===true);
    await browserExpect(page.getByRole('checkbox',{name:'Select Carol',exact:true})).toBeEnabled();
    await settled();expect(backend.reads).toHaveLength(2);expect(rpc).toHaveLength(0);
    const carol=page.getByRole('checkbox',{name:'Select Carol',exact:true});await carol.focus();await page.keyboard.press('Space');
    await browserExpect(page.locator('#selected')).toHaveText('3');
    await page.getByRole('button',{name:'Previous page',exact:true}).click();
    const alice=page.getByRole('checkbox',{name:'Select Alice',exact:true});await browserExpect(alice).toBeEnabled();
    await browserExpect(page.getByRole('button',{name:'Previous page',exact:true})).toBeFocused();
    await alice.check();await browserExpect(page.locator('#selected')).toHaveText('1,3');
    await page.getByRole('button',{name:'Next page',exact:true}).click();await browserExpect(carol).toBeEnabled();await browserExpect(carol).toBeChecked();
    await page.goBack();await browserExpect(alice).toBeEnabled();await browserExpect(alice).toBeChecked();
    const filter=page.getByRole('searchbox',{name:'Filter rows'});await filter.fill('Eve');
    await browserExpect(page.getByRole('cell',{name:'Eve',exact:true})).toBeVisible();
    await browserExpect.poll(()=>new URL(page.url()).searchParams.get('search')).toBe('Eve');
    await browserExpect(filter).toBeFocused();
    await browserExpect(page.locator('#selected')).toHaveText('1,3');
    await filter.fill('no-match');await browserExpect(page.locator('.cs-data-table').getByRole('status')).toHaveText('No matching rows.');
    await filter.fill('');await browserExpect(alice).toBeEnabled();
    const sort=page.getByRole('button',{name:'Name',exact:true});await sort.click();
    await browserExpect.poll(()=>new URL(page.url()).searchParams.get('direction')).toBe('asc');
    await sort.click();await browserExpect(page.getByRole('cell',{name:'Eve',exact:true})).toBeVisible();
    await page.getByRole('combobox',{name:'Rows per page'}).selectOption('4');await browserExpect(page.locator('tbody tr')).toHaveCount(4);
    // Refresh failure exercises resource error/retry without a failed route transition.
    await filter.fill('Bob');
    await browserExpect.poll(()=>new URL(page.url()).searchParams.get('search')).toBe('Bob');
    await browserExpect(page.locator('tbody tr')).toHaveCount(1);
    await browserExpect(page.getByRole('cell',{name:'Bob',exact:true})).toBeVisible();
    backend.failNext();
    await page.getByRole('button',{name:'Refresh rows',exact:true}).click();
    await browserExpect(page.getByRole('alert')).toContainText('Rows unavailable');
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await browserExpect(filter).toBeFocused();
    await browserExpect(page.getByRole('cell',{name:'Bob',exact:true})).toBeVisible();
    await browserExpect(page.locator('#selected')).toHaveText('1,3');
    expect(rpc.length).toBeGreaterThan(0);
    expect(backend.reads.some(query=>query.page==='2')).toBe(true);
    expect(backend.reads.some(query=>query.size==='4'&&query.direction==='desc')).toBe(true);
    expect(errors).toEqual([]);
  }catch(error){console.error('Table diagnostics',JSON.stringify({url:page.url(),reads:backend.reads,rpc:rpc.length,errors,body:await page.locator('main').innerText()}));throw error;}finally{await page.close();}
}
