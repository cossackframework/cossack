import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

export async function writeFormControllerAcceptance(root) {
  const write=async(file,source)=>{const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source);};
  await write('src/FormSchema.ts',`import {input} from '@cossackframework/core';
    export const schema=input.object({profile:input.object({name:input.string({required:true,minLength:2}).refine(async(value)=>{
      if(typeof window!=='undefined'&&value==='wait-validation')return await (window as any).__formValidationPromise;return true;
    },'Old validation failure'),age:input.number({coerce:true,min:18})}),enabled:input.boolean({coerce:true}),items:input.array(input.object({name:input.string({required:true})})),attachment:input.file().optional()});
    export const audit:Array<Record<string,unknown>>=[];
  `);
  await write('src/pages/form/index.ts',`import {Cossack,Page,Client,ClientState,Server,createFormController,createFormBindings,ActionValidationError} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';import {schema,audit} from '../../FormSchema';
    @Page({transport:'http'})export default class FormPage extends Cossack {
      form=createFormController(schema,{profile:{name:'',age:'17'},enabled:false,items:[{name:'first'}],attachment:undefined});
      bindings=createFormBindings(this.form,{id:'profile'});unsubscribe?:()=>void;
      @ClientState() outcome='';@ClientState() uploaded='';
      @Client() onMount(){this.unsubscribe=this.form.subscribe(()=>{void this.requestUpdate();});(window as any).__formFixture=this;}
      onCleanup(){this.unsubscribe?.();}
      @Server({input:schema})async save(data:any){
        const record={name:data.profile.name,age:data.profile.age,enabled:data.enabled,item:data.items[0].name,
          file:data.attachment?{name:data.attachment.name,type:data.attachment.type,text:await data.attachment.text()}:null};audit.push(record);
        if(data.profile.name==='reserved')throw new ActionValidationError({profile:{name:'Name already taken'},_:'Review server errors'});
        return record;
      }
      @Client() result(value:any){this.outcome=value.status;if(value.status==='submitted')this.uploaded=JSON.stringify(value.result);}
      render(){const name=this.bindings.field('profile.name',{id:'form-name',descriptionId:'name-help'}),age=this.bindings.field('profile.age',{id:'form-age'}),enabled=this.bindings.field('enabled',{kind:'checkbox',id:'form-enabled'}),item=this.bindings.field('items.0.name',{id:'form-item'}),file=this.bindings.field('attachment',{kind:'file',id:'form-file'});
        return html\`<main><form ...=\${this.bindings.form(data=>this.save(data),{focusInvalid:true,onResult:value=>this.result(value)})} id="native-form">
          <label ...=\${name.label}>Name</label><p id="name-help">Choose a profile name</p><input ...=\${name.input}/><span ...=\${name.error}>\${name.errorMessage??''}</span>
          <label ...=\${age.label}>Age</label><input ...=\${age.input}/><span ...=\${age.error}>\${age.errorMessage??''}</span>
          <label ...=\${enabled.label}>Enabled</label><input type="checkbox" ...=\${enabled.input}/>
          <label ...=\${item.label}>First item</label><input ...=\${item.input}/>
          <label ...=\${file.label}>Attachment</label><input type="file" ...=\${file.input}/>
          <div id="profile-errors" role="alert" tabindex="-1">\${this.form.formError??''}</div>
          <button type="submit" id="form-submit">Save</button><button type="reset" id="form-reset">Reset</button>
          <output id="form-outcome">\${this.outcome}</output><output id="form-uploaded">\${this.uploaded}</output>
          <output id="form-dirty">\${String(this.form.isDirty)}</output></form></main>\`;}
    }
  `);
  await write('src/pages/api/form-audit.ts',`import {audit} from '../../FormSchema';export const GET=(c:any)=>c.json(audit);`);
  await write('form-controller-types.ts',`import {createFormController,createFormBindings,input} from '@cossackframework/core';
    const schema=input.object({profile:input.object({age:input.number({coerce:true})}),items:input.array(input.object({name:input.string()})),attachment:input.file().optional()});
    const form=createFormController(schema,{profile:{age:'18'},items:[{name:'first'}],attachment:undefined});const fields=createFormBindings(form,{id:'test'});
    fields.field('profile.age');fields.field('items.0.name');fields.field('attachment',{kind:'file'});form.setFieldValue('profile.age','21');form.setFieldValue('items.0.name','edited');
    // @ts-expect-error unknown nested field is rejected
    fields.field('profile.unknown');
    // @ts-expect-error invalid array entry field is rejected
    form.getFieldValue('items.0.unknown');
    // @ts-expect-error wrong field value type is rejected
    form.setFieldValue('items.0.name',false);
    // @ts-expect-error invalid raw age is rejected
    form.setFieldValue('profile.age',false);
  `);
}

export async function checkFormControllerAcceptance(browser,origin) {
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let releaseHeld;
  const audit=async()=>{const response=await fetch(origin+'/api/form-audit');expect(response.status).toBe(200);return response.json();};
  try {
    await page.goto(origin+'/form');await page.waitForFunction(()=>window.__cossackReady&&window.__formFixture);
    const name=page.getByLabel('Name',{exact:true}),age=page.getByLabel('Age',{exact:true});
    await name.press('Enter');await browserExpect(page.locator('#form-outcome')).toHaveText('invalid');await browserExpect(name).toBeFocused();
    await browserExpect(name).toHaveAttribute('aria-invalid','true');
    const described=(await name.getAttribute('aria-describedby')).split(/\s+/);expect(described).toContain('name-help');
    expect(described.some(id=>id!=='name-help')).toBe(true);
    for(const id of described.filter(id=>id!=='name-help'))await browserExpect(page.locator('[id="'+id+'"]')).not.toHaveText('');
    expect(await audit()).toEqual([]);
    await name.fill('reserved');await age.fill('22');await page.getByLabel('Enabled',{exact:true}).check();await page.getByLabel('First item',{exact:true}).fill('second');
    await page.getByLabel('Attachment',{exact:true}).setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from('FORM_NATIVE_FILE_CONTENT')});
    const multipart=page.waitForRequest(request=>request.url().endsWith('/upload'));
    await name.press('Enter');const upload=await multipart;expect(upload.headers()['content-type']).toContain('multipart/form-data');
    await browserExpect(page.locator('#profile-errors')).toHaveText('Review server errors');
    await browserExpect(name).toBeFocused();await browserExpect(name).toHaveAttribute('aria-invalid','true');
    await name.fill('accepted');await name.press('Enter');await browserExpect(page.locator('#form-outcome')).toHaveText('submitted');
    const expected={name:'accepted',age:22,enabled:true,item:'second',file:{name:'fixture.txt',type:'text/plain',text:'FORM_NATIVE_FILE_CONTENT'}};
    expect(JSON.parse(await page.locator('#form-uploaded').textContent())).toEqual(expected);
    expect((await audit()).at(-1)).toEqual(expected);

    await page.evaluate(()=>{window.__formValidationPromise=new Promise(resolve=>{window.__formValidationRelease=resolve;});});
    await name.fill('wait-validation');await name.press('Enter');await page.waitForFunction(()=>window.__formFixture.form.isSubmitting);
    await name.fill('later edit');await page.evaluate(()=>window.__formValidationRelease(false));await browserExpect(page.locator('#form-outcome')).toHaveText('stale');
    await browserExpect(name).toHaveValue('later edit');await browserExpect(name).toHaveAttribute('aria-invalid','false');

    const pending=new Promise(resolve=>{releaseHeld=resolve;});let held=false;
    await page.route('**/upload',async route=>{const response=await route.fetch();held=true;await pending;await route.fulfill({response});});
    const before=(await audit()).length;
    await name.fill('reserved');await name.press('Enter');await browserExpect.poll(()=>held).toBe(true);
    await name.press('Enter');await name.fill('fresh after submit');releaseHeld();
    await browserExpect(page.locator('#form-outcome')).toHaveText('stale');
    await browserExpect(name).toHaveValue('fresh after submit');await browserExpect(name).toHaveAttribute('aria-invalid','false');
    expect((await audit()).length-before).toBe(1);
    await page.locator('#form-reset').click();await browserExpect(name).toHaveValue('');await browserExpect(age).toHaveValue('17');
    await browserExpect(page.getByLabel('Enabled',{exact:true})).not.toBeChecked();await browserExpect(page.getByLabel('First item',{exact:true})).toHaveValue('first');
    expect(await page.locator('#form-file').evaluate(input=>input.files.length)).toBe(0);
    await browserExpect(page.locator('#form-dirty')).toHaveText('false');await browserExpect(page.locator('#profile-errors')).toHaveText('');
    expect(await page.evaluate(()=>window.__formFixture.form.touched.size)).toBe(0);expect(errors).toEqual([]);
  } finally {releaseHeld?.();await page.close();}
}
