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
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));

it('keeps native labels, keyboard state, validation, form data and event targets', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-native-controls-'));
  let server,browser;
  try {
    await fs.writeFile(path.join(root,'index.html'),'<html><body><main id="app"></main><script type="module" src="/main.js"></script></body></html>');
    await fs.writeFile(path.join(root,'style.css'), `
@import ${JSON.stringify(require.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository,'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository,'packages/ui/src'))};
`);
    await fs.writeFile(path.join(root,'main.js'), `
import './style.css';
import {Button,Input,Label,Checkbox,Switch,Form,RadioGroup,Slider} from '@cossackframework/ui';
import {html,component,render,live,nothing} from '@cossackframework/renderer';
let email='',accepted=false,enabled=false,disabled=false,fieldsetDisabled=false,disableMode='attribute',submitted=0,plan='free',level=1500,limit=2000,groupDisabled=false;
let planItems=[{value:'free',label:'Free plan'},{value:'pro',label:'Pro plan'},{value:'team',label:'Team plan',disabled:true}];
window.events=[];window.choiceEvents=[];window.groupEvents=[];
function draw(){render(component(Form,{id:'settings',novalidate:false,submit:event=>{
  window.formData=Object.fromEntries(new FormData(event.currentTarget));submitted++;draw();
}},html\`
  <fieldset id="controls" ?disabled=\${fieldsetDisabled}>
  \${component(Label,{for:'email'},'Email')}
  \${component(Input,{id:'email',name:'email',type:'email',required:true,disabled,'.value':email,
    'aria-describedby':'email-help','data-testid':'email',class:'custom-input',
    '@input':event=>{email=event.currentTarget.value;window.events.push([event.type,event.currentTarget.tagName]);}})}
  <p id="email-help">Use your work address</p>
  \${component(Checkbox,{id:'accepted',name:'accepted',value:'yes',checked:accepted,label:'Accept terms',...(disableMode==='presence'?{'?disabled':disabled}:{disabled}),
    '@change':event=>{accepted=event.currentTarget.checked;window.events.push([event.type,event.currentTarget.tagName]);draw();}})}
  \${component(Switch,{id:'enabled',name:'enabled',value:'yes',checked:enabled,...(disableMode==='presence'?{'?disabled':disabled}:{disabled}),
    '@change':event=>{enabled=event.currentTarget.checked;draw();}},'Enable notifications')}
  \${component(RadioGroup,{name:'plan',value:plan,items:planItems,required:true,disabled:groupDisabled,
    'aria-label':'Plan',onValueChange:(value,event)=>{plan=value;window.choiceEvents.push([value,event.currentTarget.tagName]);draw();},
    '@change':event=>window.groupEvents.push(event.currentTarget.tagName)})}
  \${component(Slider,{name:'level',value:level,min:1000,max:limit,step:100,label:'Level',disabled:groupDisabled,
    '@input':event=>{level=event.currentTarget.valueAsNumber;draw();}})}
  </fieldset>
  \${component(Button,{type:'submit',disabled},'Save')}
  \${component(Button,{type:'button','@click':()=>{accepted=false;enabled=false;plan='free';draw();}},'Reset controls')}
  <output id="submits">\${submitted}</output>
\`),document.querySelector('#app'));}
window.setDisabled=(value,mode='attribute')=>{disabled=value;disableMode=mode;draw();};
window.setFieldsetDisabled=value=>{fieldsetDisabled=value;draw();};
window.setRange=(value,max)=>{level=value;limit=max;draw();};
window.setGroupDisabled=value=>{groupDisabled=value;draw();};
window.reversePlans=()=>{planItems=[...planItems].reverse();draw();};draw();
window.verifySelectBindings=async()=>{
  const results=[];
  for(const spread of [false,true]){
    const container=document.createElement('div');document.body.append(container);
    const template=(value,values=['a','b'])=>{
      const options=values.map(v=>html\`<option value=\${v}>\${v}</option>\`);
      return spread?html\`<select ...=\${{'.value':value}}>\${options}</select>\`
        :html\`<select .value=\${value}>\${options}</select>\`;
    };
    render(template('b'),container);await Promise.resolve();
    const select=container.querySelector('select');results.push(select.value);
    select.value='a';render(template('b'),container);await Promise.resolve();results.push(select.value);
    render(template(live('b')),container);await Promise.resolve();results.push(select.value);
    render(template(live('b'),['b','a']),container);await Promise.resolve();results.push(select.value);
    render(template('a'),container);render(template('b'),container);render(template('b'),container);
    await Promise.resolve();results.push(select.value);
    render(template(live('b')),container);render(template(nothing),container);select.value='a';
    await Promise.resolve();results.push(select.value);container.remove();
  }
  return results;
};

`);
    await build({root,configFile:false,logLevel:'silent',plugins:[tailwind()],resolve:{alias:{
      '@cossackframework/ui':path.join(repository,'packages/ui/dist/index.js'),
      '@cossackframework/core':path.join(repository,'packages/core/dist/index.js'),
      '@cossackframework/renderer':path.join(repository,'packages/renderer/dist/index.js'),
    }},build:{outDir:'dist',emptyOutDir:true}});
    server=createServer(async(request,response)=>{
      const url=new URL(request.url,'http://localhost');
      const file=path.resolve(root,'dist','.'+(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(path.join(root,'dist')+path.sep)){response.writeHead(404);response.end();return;}
      try{response.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(await fs.readFile(file));}
      catch{response.writeHead(404);response.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const email=page.getByRole('textbox',{name:'Email',exact:true});
    const checkbox=page.getByRole('checkbox',{name:'Accept terms',exact:true});
    const toggle=page.getByRole('switch',{name:'Enable notifications',exact:true});
    const range=page.getByRole('slider',{name:'Level',exact:true});
    await browserExpect(range).toHaveValue('1500');
    await browserExpect(email).toHaveAccessibleDescription('Use your work address');
    await browserExpect(email).toHaveClass(/custom-input/);await browserExpect(email).toHaveClass(/cs-input/);
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await browserExpect(page.locator('#submits')).toHaveText('0');await browserExpect(email).toBeFocused();
    await email.fill('user@example.test');
    await checkbox.focus();await page.keyboard.press('Space');await browserExpect(checkbox).toBeChecked();
    await page.keyboard.press('Tab');await browserExpect(toggle).toBeFocused();
    await browserExpect(page.locator('.cs-switch__track')).not.toHaveCSS('box-shadow','none');
    await page.keyboard.press('Space');await browserExpect(toggle).toBeChecked();
    await browserExpect(toggle).toHaveAttribute('aria-checked','true');
    await page.getByRole('button',{name:'Save',exact:true}).click();await browserExpect(page.locator('#submits')).toHaveText('1');
    expect(await page.evaluate(()=>window.formData)).toEqual({email:'user@example.test',accepted:'yes',enabled:'yes',plan:'free',level:'1500'});
    await page.getByRole('button',{name:'Reset controls',exact:true}).click();
    await browserExpect(checkbox).not.toBeChecked();await browserExpect(toggle).not.toBeChecked();
    await browserExpect(toggle).toHaveAttribute('aria-checked','false');
    await page.evaluate(()=>window.setDisabled(true));
    await browserExpect(email).toBeDisabled();await browserExpect(checkbox).toBeDisabled();await browserExpect(toggle).toBeDisabled();
    await browserExpect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
    await page.evaluate(()=>window.setDisabled(false));
    await email.focus();await page.keyboard.press('Enter');await browserExpect(page.locator('#submits')).toHaveText('2');
    expect(await page.evaluate(()=>window.formData)).toEqual({email:'user@example.test',plan:'free',level:'1500'});
    expect(await page.evaluate(()=>window.events)).toContainEqual(['input','INPUT']);
    expect(await page.evaluate(()=>window.events)).toContainEqual(['change','INPUT']);
    const free=page.getByRole('radio',{name:'Free plan',exact:true});
    const pro=page.getByRole('radio',{name:'Pro plan',exact:true});
    await free.focus();await page.keyboard.press('ArrowDown');await browserExpect(pro).toBeChecked();
    await page.keyboard.press('ArrowUp');await browserExpect(free).toBeChecked();
    await page.keyboard.press('ArrowDown');await browserExpect(pro).toBeChecked();
    expect(await page.evaluate(()=>window.choiceEvents)).toEqual([['pro','INPUT'],['free','INPUT'],['pro','INPUT']]);
    expect(await page.evaluate(()=>window.groupEvents)).toEqual(['DIV','DIV','DIV']);
    const proNode=await pro.elementHandle();
    await page.evaluate(()=>window.reversePlans());
    await browserExpect(page.locator('.cs-radio-group input').first()).toHaveValue('team');
    expect(await proNode.evaluate(node=>node===document.querySelector('input[value=pro]'))).toBe(true);
    await browserExpect(pro).toBeChecked();
    await page.getByRole('button',{name:'Reset controls',exact:true}).click();
    await browserExpect(free).toBeChecked();await browserExpect(pro).not.toBeChecked();
    await range.focus();await page.keyboard.press('ArrowRight');await browserExpect(range).toHaveValue('1600');await browserExpect(range).toBeFocused();
    await page.evaluate(()=>window.setRange(2500,2000));await browserExpect(range).toHaveValue('2000');
    await page.evaluate(()=>window.setRange(2500,3000));await browserExpect(range).toHaveValue('2500');
    await browserExpect(page.locator('.cs-switch__track')).toHaveCSS('width','44px');
    for(const dark of [false,true]) {
      await page.locator('html').evaluate((element,dark)=>element.classList.toggle('dark',dark),dark);
      for(const mode of ['attribute','presence']) {
        await page.evaluate(mode=>window.setDisabled(true,mode),mode);
        for(const wrapper of ['.cs-checkbox','.cs-switch']) {
          await browserExpect(page.locator(wrapper)).toHaveCSS('opacity','0.5');
          await browserExpect(page.locator(wrapper)).toHaveCSS('cursor','not-allowed');
        }
        await browserExpect(checkbox).toBeDisabled();await browserExpect(toggle).toBeDisabled();
        await page.evaluate(mode=>window.setDisabled(false,mode),mode);
        for(const wrapper of ['.cs-checkbox','.cs-switch'])await browserExpect(page.locator(wrapper)).toHaveCSS('opacity','1');
      }
      await page.evaluate(()=>window.setFieldsetDisabled(true));
      await browserExpect(checkbox).toBeDisabled();await browserExpect(toggle).toBeDisabled();
      await browserExpect(pro).toBeDisabled();await browserExpect(range).toBeDisabled();
      await browserExpect(range).toHaveCSS('opacity','0.5');
      await browserExpect(pro.locator('..')).toHaveCSS('opacity','0.5');
      await browserExpect(page.locator('.cs-checkbox')).toHaveCSS('opacity','0.5');
      await browserExpect(page.locator('.cs-switch')).toHaveCSS('opacity','0.5');
      await page.evaluate(()=>window.setFieldsetDisabled(false));
      await browserExpect(checkbox).toBeEnabled();await browserExpect(toggle).toBeEnabled();
      await browserExpect(page.locator('.cs-checkbox')).toHaveCSS('opacity','1');
      await browserExpect(page.locator('.cs-switch')).toHaveCSS('opacity','1');
    }
    await page.evaluate(()=>window.setGroupDisabled(true));
    await browserExpect(pro).toBeDisabled();await browserExpect(range).toBeDisabled();
    await browserExpect(pro.locator('..')).toHaveCSS('opacity','0.5');await browserExpect(range).toHaveCSS('opacity','0.5');
    await page.evaluate(()=>window.setGroupDisabled(false));
    await browserExpect(pro).toBeEnabled();await browserExpect(range).toBeEnabled();
    await browserExpect(pro.locator('..')).toHaveCSS('opacity','1');await browserExpect(range).toHaveCSS('opacity','1');
    await browserExpect(page.getByRole('radio',{name:'Team plan',exact:true})).toBeDisabled();
    expect(await page.evaluate(()=>window.verifySelectBindings())).toEqual(['b','a','b','b','b','a','b','a','b','b','b','a']);
    expect(errors).toEqual([]);
  }finally{await browser?.close();if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.rm(root,{recursive:true,force:true});}
},120000);
