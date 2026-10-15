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
import { SettingsPanel } from '../../ui/dist/blocks/index.js';
import { UI_COMPONENTS } from '../src/templates/ui.js';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(new URL('../../framework/package.json',import.meta.url));
const {build}=await import(require.resolve('vite'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));
const sections=[{id:'account',title:'Account',description:'Profile preferences',rows:[
  {key:'email',type:'switch',label:'Email alerts',hint:'Receive updates'},
  {key:'name',type:'text',label:'Display name',hint:'Visible to others',autocomplete:'name'},
  {key:'locked',type:'text',label:'Locked field',readonly:true},
  {key:'delete',type:'button',label:'Account removal',action:'Delete',variant:'destructive'},
]}];
it.each(['package','ejected'])('owns %s settings values, native reset and labeled actions',async kind=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-settings-panel-'));let server,browser;
  const source=`(p={})=>html\`<button id="before" type="button">Before</button><form id="settings-form" @submit=\${event=>event.preventDefault()}><main style="padding:16px">\${component(SettingsPanel,{id:'settings',sections:p.sections??sections,defaultValues:{email:true,name:'Jane',locked:'Fixed'},onAction:()=>{},...p})}</main><button type="reset">Reset</button></form><button id="after" type="button">After</button>\``;
  const template=new Function('html','component','SettingsPanel','sections',`return ${source}`)(html,component,SettingsPanel,sections);
  try{
    const scope=path.join(root,'node_modules/@cossackframework');await fs.mkdir(scope,{recursive:true});
    for(const name of ['core','renderer','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(scope,name),'dir');
    await fs.symlink(path.join(repository,'node_modules/@cossackframework/solar-icons'),path.join(scope,'solar-icons'),'dir');
    await fs.writeFile(path.join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{experimentalDecorators:true,useDefineForClassFields:false,target:'ES2022'}}));
    if(kind==='ejected'){
      const spy=vi.spyOn(process,'cwd').mockReturnValue(path.join(repository,'packages/framework'));
      try{await fs.writeFile(path.join(root,'SettingsPanel.ts'),UI_COMPONENTS['settings-panel'].template());}finally{spy.mockRestore();}
    }
    await fs.writeFile(path.join(root,'index.html'),`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app">${minifyHtml(renderToString(template(),{hydrate:true}))}</main><script type="module" src="/main.js"></script></body></html>`);
    await fs.writeFile(path.join(root,'style.css'),`@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);\n@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};\n@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};\n@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};`);
    await fs.writeFile(path.join(root,'main.js'),`
import './style.css';import {html,component,hydrate,render} from '@cossackframework/renderer';
import {SettingsPanel} from '${kind==='package'?'@cossackframework/ui/blocks':'./SettingsPanel.ts'}';
const sections=${JSON.stringify(sections)};
for(const section of sections){section.rows.forEach(Object.freeze);Object.freeze(section.rows);Object.freeze(section);}Object.freeze(sections);window.sections=sections;
const template=${source},container=document.querySelector('#app'),original=container.querySelector('#settings');
window.changes=[];window.actions=[];window.targets=[];window.accept=false;window.mutate=false;window.throwChange=false;
let props={};
const onValuesChange=values=>{window.changes.push({...values});if(window.accept)window.update({values});if(window.mutate)values.name='MUTATED';if(window.throwChange)throw new Error('callback failure');};
const current=()=>({...props,onValuesChange,onAction:key=>window.actions.push(key),'@click':event=>window.targets.push(event.currentTarget.tagName)});
window.update=patch=>{props={...props,...patch};render(template(current()),container);};
window.remount=(controlled=false)=>{render(html\`<p>Between</p>\`,container);props=controlled?{defaultValues:undefined,values:{email:true,name:'Jane',locked:'Fixed'}}:{};render(template(current()),container);};
window.unmount=()=>render(html\`<p>Removed</p>\`,container);
hydrate(template(current()),container);window.retained=original===container.querySelector('#settings');window.ready=true;
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
    await browserExpect(staticPage.getByLabel('Display name',{exact:true})).toHaveValue('Jane');
    await browserExpect(staticPage.getByRole('switch',{name:'Email alerts'})).toBeChecked();await staticContext.close();
    const page=await browser.newPage({viewport:{width:360,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.ready);
    expect(await page.evaluate(()=>window.retained)).toBe(true);
    const name=page.getByLabel('Display name',{exact:true}),email=page.getByRole('switch',{name:'Email alerts'}),reset=page.getByRole('button',{name:'Reset',exact:true});
    await browserExpect(name).toHaveAccessibleDescription('Visible to others');await browserExpect(email).toHaveAccessibleDescription('Receive updates');
    await page.locator('#before').focus();await page.keyboard.press('Tab');await browserExpect(email).toBeFocused();
    await page.keyboard.press('Space');await browserExpect(email).not.toBeChecked();await browserExpect(email).not.toHaveAttribute('aria-checked');
    await name.fill('Edited');await page.evaluate(()=>window.update({class:'custom',defaultValues:{name:'Ignored',email:true}}));await browserExpect(name).toHaveValue('Edited');
    await page.evaluate(()=>{window.mutate=true;});await name.fill('Safe');await page.evaluate(()=>window.update({title:'Unrelated'}));await browserExpect(name).toHaveValue('Safe');
    expect(await page.evaluate(()=>new FormData(document.querySelector('form')).get('name'))).toBe('Safe');
    await page.getByRole('button',{name:'Delete',exact:true}).click();expect(await page.evaluate(()=>window.actions)).toEqual(['delete']);expect(await page.evaluate(()=>window.targets.every(target=>target==='DIV'))).toBe(true);
    await page.evaluate(()=>{window.mutate=false;document.querySelector('form').addEventListener('reset',event=>event.preventDefault(),{once:true});});
    await reset.click();await browserExpect(name).toHaveValue('Safe');
    await reset.click();await browserExpect(name).toHaveValue('Jane');await browserExpect(email).toBeChecked();
    await name.fill('Before two resets');
    await page.evaluate(()=>{const form=document.querySelector('form');form.reset();form.addEventListener('reset',event=>event.preventDefault(),{once:true});form.reset();});
    await browserExpect(name).toHaveValue('Jane');
    await page.evaluate(()=>window.update({disabled:true}));await browserExpect(name).toBeDisabled();await browserExpect(email).toBeDisabled();await browserExpect(page.getByRole('button',{name:'Delete',exact:true})).toBeDisabled();
    await page.evaluate(()=>window.update({disabled:false}));
    await name.focus();await page.evaluate(()=>window.update({sections:[{...window.sections[0],rows:[window.sections[0].rows[1],window.sections[0].rows[0],window.sections[0].rows[2],window.sections[0].rows[3]]}]}));await browserExpect(name).toBeFocused();
    await page.evaluate(()=>window.update({sections:[{...window.sections[0],rows:[window.sections[0].rows[0]]}]}));await browserExpect(email).toBeFocused();
    await page.evaluate(()=>window.remount(true));await browserExpect(name).toHaveValue('Jane');await name.fill('Rejected');await browserExpect(name).toHaveValue('Rejected');await page.evaluate(()=>window.update({}));await browserExpect(name).toHaveValue('Jane');
    await page.locator('label[for="settings-field-email"]').click();await browserExpect(email).not.toBeChecked();await page.evaluate(()=>window.update({}));await browserExpect(email).toBeChecked();await browserExpect(email).not.toHaveAttribute('aria-checked');
    await page.evaluate(()=>{window.accept=true;});await name.fill('Accepted');await browserExpect(name).toHaveValue('Accepted');await page.locator('label[for="settings-field-email"]').click();await browserExpect(email).not.toBeChecked();
    await reset.click();await browserExpect(name).toHaveValue('Jane');await browserExpect(email).toBeChecked();
    await page.evaluate(()=>{window.accept=false;window.throwChange=true;});await name.fill('Throw');await browserExpect(name).toHaveValue('Jane');expect(errors.splice(0)).toEqual(['callback failure']);
    await page.evaluate(()=>{window.throwChange=false;window.update({values:{email:false,name:'External',locked:'Fixed'}});});await browserExpect(name).toHaveValue('External');await browserExpect(email).not.toBeChecked();
    await reset.click();await browserExpect(name).toHaveValue('Jane');await page.evaluate(()=>window.update({}));await browserExpect(name).toHaveValue('External');await browserExpect(email).not.toBeChecked();
    for(const width of [320,900]){await page.setViewportSize({width,height:850});expect(await page.locator('#settings').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);}
    const changes=await page.evaluate(()=>window.changes.length);
    await page.evaluate(()=>{document.querySelector('form').reset();window.unmount();});await page.waitForTimeout(30);expect(await page.evaluate(()=>window.changes.length)).toBe(changes);
    await page.evaluate(()=>window.remount());await name.fill('Again');await reset.click();await browserExpect(name).toHaveValue('Jane');
    expect(errors).toEqual([]);
  }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
},120000);
