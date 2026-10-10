import { it, expect, vi } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { html, renderToString, minifyHtml } from '../../renderer/dist/server.js';
import { component } from '../../renderer/dist/index.js';
import { DashboardStat } from '../../ui/dist/blocks/index.js';
import { ArrowRightIcon } from '@cossackframework/solar-icons/arrow-right';
import { UI_COMPONENTS } from '../src/templates/ui.js';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(new URL('../../framework/package.json',import.meta.url));
const {build}=await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));
const makeStats=icon=>[
  {id:'cost',label:'Cost',value:'$20',change:'+2 this month',trend:'up',tone:'negative',icon},
  {id:'errors',label:'Errors',value:2,change:'-3 this month',trend:'down',tone:'positive'},
  {id:'zero',label:'Zero',value:0,change:'0%',trend:'neutral'},
  {id:'long',label:'Long'.repeat(25),value:'1234567890'.repeat(8)},
];
it.each(['package','ejected'])('renders the %s metric list with native values, explicit meaning and responsive updates',async kind=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-dashboard-stat-'));let server,browser;
  const source=`(p={})=>html\`<button id="before" type="button">Before</button><main style="padding:16px">\${component(DashboardStat,{id:'metrics','aria-label':'Metrics',stats:p.stats??baseStats,columns:p.columns??4,dir:p.dir,class:p.class??'custom',style:'width:100%','data-root':'metrics','@click':p.click,trendLabels:p.trendLabels,toneLabels:p.toneLabels})}</main><button id="after" type="button">After</button>\``;
  const template=new Function('html','component','DashboardStat','baseStats',`return ${source}`)(html,component,DashboardStat,makeStats(ArrowRightIcon));
  try{
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['core','renderer','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.symlink(path.join(repository,'node_modules/@cossackframework/solar-icons'),path.join(scope,'solar-icons'),'dir');
    await fs.writeFile(path.join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{experimentalDecorators:true,useDefineForClassFields:false,target:'ES2022'}}));
    if(kind==='ejected'){
      const spy=vi.spyOn(process,'cwd').mockReturnValue(path.join(repository,'packages/framework'));
      try{await fs.writeFile(path.join(root,'DashboardStat.ts'),UI_COMPONENTS['dashboard-stat'].template());}finally{spy.mockRestore();}
    }
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app">${minifyHtml(renderToString(template(),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);\n@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};\n@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};\n@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';import {html,component,hydrate,render,ifDefined} from '@cossackframework/renderer';
import {DashboardStat} from '${kind==='package'?'@cossackframework/ui/blocks':'./DashboardStat.ts'}';
import {ArrowRightIcon} from '@cossackframework/solar-icons/arrow-right';
const makeStats=${makeStats.toString()},baseStats=Object.freeze(makeStats(ArrowRightIcon).map(item=>Object.freeze(item)));
const template=${source},container=document.querySelector('#app'),originalList=container.querySelector('#metrics');
window.originalItems=new Map([...container.querySelectorAll('[data-stat-id]')].map(node=>[node.dataset.statId,node]));
let props={};window.targets=[];const current=()=>({...props,click:event=>window.targets.push(event.currentTarget.tagName)});
window.update=patch=>{props={...props,...patch};render(template(current()),container);};
window.optionalClass=value=>window.update({class:ifDefined(value)});
window.reorder=()=>window.update({stats:[{...baseStats[2],value:5},baseStats[1],baseStats[0],baseStats[3]]});
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
hydrate(template(current()),container);window.retained=originalList===container.querySelector('#metrics');window.ready=true;
`);
    await build({root,configFile:false,logLevel:'silent',plugins:[tailwind()],build:{outDir:'dist',emptyOutDir:true}});
    server=createServer(async(request,response)=>{
      const pathname=new URL(request.url,'http://localhost').pathname,file=path.resolve(root,'dist','.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(path.join(root,'dist')+path.sep)){response.writeHead(404);response.end();return;}
      try{response.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(await fs.readFile(file));}
      catch{response.writeHead(404);response.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});const url=`http://127.0.0.1:${server.address().port}`;
    const staticContext=await browser.newContext({javaScriptEnabled:false}),staticPage=await staticContext.newPage();await staticPage.goto(url);
    await browserExpect(staticPage.getByRole('list',{name:'Metrics'})).toBeVisible();await browserExpect(staticPage.locator('[data-stat-id="zero"] dd').first()).toHaveText('0');await staticContext.close();
    const page=await browser.newPage({viewport:{width:360,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.ready);
    expect(await page.evaluate(()=>window.retained)).toBe(true);const list=page.getByRole('list',{name:'Metrics'});
    await browserExpect(list.getByRole('listitem')).toHaveCount(4);await browserExpect(list.getByRole('term',{name:'',exact:true}).first()).toHaveText('Cost');
    await browserExpect(list).not.toContainText(')}');await browserExpect(list).toHaveClass(/custom/);
    expect(await list.locator('svg path').first().evaluate(node=>node instanceof SVGPathElement&&node.getBBox().width>0)).toBe(true);
    expect(await list.getByRole('img').count()).toBe(0);
    await page.locator('#before').focus();await page.keyboard.press('Tab');await browserExpect(page.locator('#after')).toBeFocused();
    await list.locator('[data-stat-id="cost"] dt').click();expect(await page.evaluate(()=>window.targets)).toEqual(['UL']);
    await browserExpect(list.locator('[data-stat-id="cost"]')).toContainText('Increase: +2 this month · Unfavorable');
    await browserExpect(list.locator('[data-stat-id="errors"]')).toContainText('Decrease: -3 this month · Favorable');
    await browserExpect(list.locator('[data-stat-id="zero"] .cs-dashboard-stat__change')).toHaveClass(/text-muted-foreground/);
    for(const dark of [false,true]){
      await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);
      const colors=await list.locator('.cs-dashboard-stat__change').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).color));expect(new Set(colors).size).toBe(3);
    }
    for(const width of [320,640,1100]){
      await page.setViewportSize({width,height:800});
      const layout=await list.evaluate(node=>({columns:getComputedStyle(node).gridTemplateColumns.split(' ').length,overflow:node.scrollWidth>node.clientWidth}));
      expect(layout.columns).toBe(width<640?1:width<768?2:4);expect(layout.overflow).toBe(false);
    }
    await page.evaluate(()=>window.update({columns:3,dir:'rtl',trendLabels:{down:'Lower'},toneLabels:{positive:'Improved'}}));
    expect(await list.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(3);
    await browserExpect(list.locator('[data-stat-id="errors"]')).toContainText('Lower: -3 this month · Improved');
    await page.evaluate(()=>window.optionalClass('optional'));
    await browserExpect(list).toHaveClass(/cs-dashboard-stat.*optional/);
    await page.evaluate(()=>window.optionalClass(undefined));
    await browserExpect(list).toHaveClass(/cs-dashboard-stat/);
    await browserExpect(list).not.toHaveClass(/optional/);
    await page.evaluate(()=>window.reorder());
    expect(await list.getByRole('listitem').evaluateAll(nodes=>nodes.map(node=>node.dataset.statId))).toEqual(['zero','errors','cost','long']);
    expect(await page.evaluate(()=>[...document.querySelectorAll('[data-stat-id]')].every(node=>node===window.originalItems.get(node.dataset.statId)))).toBe(true);
    await browserExpect(list.locator('[data-stat-id="zero"] dd').first()).toHaveText('5');
    await page.evaluate(()=>window.update({stats:[]}));await browserExpect(list.getByRole('listitem')).toHaveCount(0);
    await page.evaluate(()=>window.unmount());await browserExpect(list).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
},120000);
