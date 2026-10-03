import { it, expect } from 'vitest';
import { expect as browserExpect, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(new URL('../../framework/package.json',import.meta.url));
const {build}=await import(require.resolve('vite'));

it('keeps native labels, keyboard state, validation, form data and event targets', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-native-controls-'));
  let server,browser;
  try {
    await fs.writeFile(path.join(root,'index.html'),'<html><body><main id="app"></main><script type="module" src="/main.js"></script></body></html>');
    await fs.writeFile(path.join(root,'main.js'), `
import {Button,Input,Label,Checkbox,Switch,Form} from '@cossackframework/ui';
import {html,component,render} from '@cossackframework/renderer';
let email='',accepted=false,enabled=false,disabled=false,submitted=0;
window.events=[];
function draw(){render(component(Form,{id:'settings',novalidate:false,submit:event=>{
  window.formData=Object.fromEntries(new FormData(event.currentTarget));submitted++;draw();
}},html\`
  \${component(Label,{for:'email'},'Email')}
  \${component(Input,{id:'email',name:'email',type:'email',required:true,disabled,'.value':email,
    'aria-describedby':'email-help','data-testid':'email',class:'custom-input',
    '@input':event=>{email=event.currentTarget.value;window.events.push([event.type,event.currentTarget.tagName]);}})}
  <p id="email-help">Use your work address</p>
  \${component(Checkbox,{id:'accepted',name:'accepted',value:'yes',checked:accepted,label:'Accept terms',disabled,
    '@change':event=>{accepted=event.currentTarget.checked;window.events.push([event.type,event.currentTarget.tagName]);draw();}})}
  \${component(Switch,{id:'enabled',name:'enabled',value:'yes',checked:enabled,disabled,
    '@change':event=>{enabled=event.currentTarget.checked;draw();}},'Enable notifications')}
  \${component(Button,{type:'submit',disabled},'Save')}
  \${component(Button,{type:'button','@click':()=>{accepted=false;enabled=false;draw();}},'Reset controls')}
  <output id="submits">\${submitted}</output>
\`),document.querySelector('#app'));}
window.setDisabled=value=>{disabled=value;draw();};draw();
`);
    await build({root,configFile:false,logLevel:'silent',resolve:{alias:{
      '@cossackframework/ui':path.join(repository,'packages/ui/dist/index.js'),
      '@cossackframework/core':path.join(repository,'packages/core/dist/index.js'),
      '@cossackframework/renderer':path.join(repository,'packages/renderer/dist/index.js'),
    }},build:{outDir:'dist',emptyOutDir:true}});
    server=createServer(async(request,response)=>{
      const url=new URL(request.url,'http://localhost');
      const file=path.resolve(root,'dist','.'+(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(path.join(root,'dist')+path.sep)){response.writeHead(404);response.end();return;}
      try{response.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');response.end(await fs.readFile(file));}
      catch{response.writeHead(404);response.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const email=page.getByRole('textbox',{name:'Email',exact:true});
    const checkbox=page.getByRole('checkbox',{name:'Accept terms',exact:true});
    const toggle=page.getByRole('switch',{name:'Enable notifications',exact:true});
    await browserExpect(email).toHaveAccessibleDescription('Use your work address');
    await browserExpect(email).toHaveClass(/custom-input/);await browserExpect(email).toHaveClass(/cs-input/);
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await browserExpect(page.locator('#submits')).toHaveText('0');await browserExpect(email).toBeFocused();
    await email.fill('user@example.test');
    await checkbox.focus();await page.keyboard.press('Space');await browserExpect(checkbox).toBeChecked();
    await toggle.focus();await page.keyboard.press('Space');await browserExpect(toggle).toBeChecked();
    await browserExpect(toggle).toHaveAttribute('aria-checked','true');
    await page.getByRole('button',{name:'Save',exact:true}).click();await browserExpect(page.locator('#submits')).toHaveText('1');
    expect(await page.evaluate(()=>window.formData)).toEqual({email:'user@example.test',accepted:'yes',enabled:'yes'});
    await page.getByRole('button',{name:'Reset controls',exact:true}).click();
    await browserExpect(checkbox).not.toBeChecked();await browserExpect(toggle).not.toBeChecked();
    await browserExpect(toggle).toHaveAttribute('aria-checked','false');
    await page.evaluate(()=>window.setDisabled(true));
    await browserExpect(email).toBeDisabled();await browserExpect(checkbox).toBeDisabled();await browserExpect(toggle).toBeDisabled();
    await browserExpect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
    await page.evaluate(()=>window.setDisabled(false));
    await email.focus();await page.keyboard.press('Enter');await browserExpect(page.locator('#submits')).toHaveText('2');
    expect(await page.evaluate(()=>window.formData)).toEqual({email:'user@example.test'});
    expect(await page.evaluate(()=>window.events)).toContainEqual(['input','INPUT']);
    expect(await page.evaluate(()=>window.events)).toContainEqual(['change','INPUT']);
    expect(errors).toEqual([]);
  }finally{await browser?.close();if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.rm(root,{recursive:true,force:true});}
},120000);
