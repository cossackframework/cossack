import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
export const TURNSTILE_SECRET_SENTINEL = 'SVC05_PRIVATE_SECRET_8f19';
export const TURNSTILE_PROVIDER_SENTINEL = 'SVC05_PRIVATE_SITEVERIFY_IMPLEMENTATION_392';
export const TURNSTILE_ENV = { TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: TURNSTILE_SECRET_SENTINEL, TURNSTILE_HOSTNAME: '127.0.0.1' };
export async function writeTurnstileAcceptance(root) {
  const write = async (file, source) => { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, source); };
  await write('src/TurnstileAudit.ts', `export const audit={mutations:0,requests:0,used:new Set<string>()};`);
  await write('src/pages/api/turnstile-audit.ts', `import {audit} from '../../TurnstileAudit';export const GET=(c:any)=>c.json({mutations:audit.mutations,requests:audit.requests});`);
  await write('src/pages/contact/index.ts', `import {Cossack,Page,Client,ClientState,State,Server,ActionValidationError,createFormController,createFormBindings} from '@cossackframework/core';
import {html,component} from '@cossackframework/renderer';import {Turnstile} from '@cossackframework/ui';
import {createTurnstileVerifier} from '@cossackframework/auth/turnstile';import {config} from '@cossackframework/framework/config';
import {contactInput} from '../../turnstile-input';import {audit} from '../../TurnstileAudit';
@Page({transport:'http'})export default class ContactPage extends Cossack {
  form=createFormController(contactInput,{message:'Hello',token:''});bindings=createFormBindings(this.form,{id:'contact-form'});unsubscribe?:()=>void;
  @State() siteKey='';@ClientState() resetKey=0;@ClientState() outcome='';@ClientState() visible=true;
  @Server() async init(){this.siteKey=config<string>('turnstile.siteKey');}
  @Client() onMount(){this.unsubscribe=this.form.subscribe(()=>{void this.requestUpdate();});(window as any).__turnstileFixture=this;}
  onCleanup(){this.unsubscribe?.();this.bindings.dispose();}
  @Server({input:contactInput})async send(data:{message:string;token:string}){
    const verifier=createTurnstileVerifier({secret:config<string>('turnstile.secret'),expectedHostname:config<string>('turnstile.hostname'),expectedAction:'contact',fetch:async(_url,options)=>{
      const marker='${TURNSTILE_PROVIDER_SENTINEL}';void marker;
      const body=JSON.parse(String(options?.body));if(body.secret!==config<string>('turnstile.secret'))throw new Error('Incorrect secret');audit.requests++;
      let payload;
      if(body.response==='expired'||audit.used.has(body.response))payload={success:false,'error-codes':['timeout-or-duplicate']};
      else if(!body.response.startsWith('valid-'))payload={success:false,'error-codes':['invalid-input-response']};
      else{audit.used.add(body.response);payload={success:true,hostname:'127.0.0.1',action:'contact'};}
      return new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
    }});
    const result=await verifier.verify({token:data.token});
    if(!result.success)throw new ActionValidationError({token:'Fresh verification required.'});
    audit.mutations++;return{accepted:true};
  }
  @Client() result(value:{status:string}){this.outcome=value.status;this.resetKey++;}
  @Client() hide(){this.visible=false;}
  @Client() show(){this.visible=true;}
  render(){const message=this.bindings.field('message');return html\`<main><h1>Contact</h1><form ...=\${this.bindings.form(data=>this.send(data),{onResult:value=>this.result(value)})}>
    <label ...=\${message.label}>Message</label><input ...=\${message.input}>
    \${this.visible?component(Turnstile,{id:'contact-verification',siteKey:this.siteKey,action:'contact',resetKey:this.resetKey,onTokenChange:token=>this.form.setFieldValue('token',token),onError:error=>{(window as any).__turnstileError=error.code;}}):''}
    <p id="verification-error" role="alert">\${this.form.fieldError('token')??''}</p><button type="submit">Send</button><output id="outcome">\${this.outcome}</output></form>
    <button id="hide-widget" @click=\${()=>this.hide()}>Hide verification</button><button id="show-widget" @click=\${()=>this.show()}>Show verification</button></main>\`;}
}`);
  await write('turnstile-types.ts', `import {Turnstile,type TurnstileProps,type TurnstileClient} from '@cossackframework/ui';import {createTurnstileVerifier,type TurnstileVerification} from '@cossackframework/auth/turnstile';
const props:TurnstileProps={id:'test',siteKey:'public',theme:'dark',size:'compact',onSuccess:token=>{const text:string=token;void text;},onError:error=>{const code:string=error.code;void code;}};
const widget=new Turnstile();widget.props=props;const pending:Promise<void>=widget.reset();void pending;
const sdk:TurnstileClient={render(_element,options){options.callback('token');return'widget';},remove(_id){}};void sdk;
const result:Promise<TurnstileVerification>=createTurnstileVerifier({secret:'server',expectedHostname:'example.com',expectedAction:'contact'}).verify({token:'token'});void result;
// @ts-expect-error secret keys are not client props
const secret:TurnstileProps={id:'test',siteKey:'public',secretKey:'private'};void secret;
// @ts-expect-error unknown widget theme
const theme:TurnstileProps={id:'test',siteKey:'public',theme:'invalid'};void theme;
// @ts-expect-error action is not a numeric identifier
const action:TurnstileProps={id:'test',siteKey:'public',action:42};void action;
`);
}
const MOCK_SCRIPT = `(() => {
  const widgets = [];
  window.__turnstileMock = {widgets, emit(index,kind,value){const item=widgets[index];const fn=kind==='success'?item.options.callback:item.options[kind+'-callback'];fn(value);}};
  window.turnstile = {render(host,options){const index=widgets.length;const marker=document.createElement('span');marker.textContent='Mock verification';host.append(marker);widgets.push({host,options,removed:false});return String(index);},remove(id){const item=widgets[Number(id)];item.removed=true;item.host.replaceChildren();}};
})();`;
export async function checkTurnstileAcceptance(browser, origin) {
  const page = await browser.newPage(); const errors=[]; page.on('pageerror', error=>errors.push(error.message)); let loads=0;
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async route=>{loads++; if(loads===1) await route.abort('failed'); else await route.fulfill({status:200,contentType:'application/javascript',body:MOCK_SCRIPT});});
  const audit=async()=>{const response=await fetch(origin+'/api/turnstile-audit');expect(response.status).toBe(200);return response.json();};
  const emit=async(index,kind,value)=>page.evaluate(({index,kind,value})=>window.__turnstileMock.emit(index,kind,value),{index,kind,value});
  const waitWidgets=async count=>{try{await page.waitForFunction(count=>window.__turnstileMock?.widgets.length===count,count,{timeout:10000});}catch{throw new Error('Widget count '+count+' not reached: '+JSON.stringify(await page.evaluate(()=>({count:window.__turnstileMock?.widgets.length,visible:window.__turnstileFixture?.visible,lastError:window.__turnstileError,loads:document.querySelectorAll('script[src*=challenges]').length,status:document.getElementById('contact-verification-status')?.textContent,widgets:window.__turnstileMock?.widgets.map(item=>({removed:item.removed,connected:item.host.isConnected}))})))+'; page errors '+JSON.stringify(errors));}};
  const field=page.locator('input[name="cf-turnstile-response"]');
  try {
    const ssr=await fetch(origin+'/contact');expect(ssr.status).toBe(200);const html=await ssr.text();expect(html).toContain('cf-turnstile-response');expect(html).not.toContain(TURNSTILE_SECRET_SENTINEL);expect(html).not.toContain(TURNSTILE_PROVIDER_SENTINEL);
    await page.goto(origin+'/contact');await page.waitForFunction(()=>window.__cossackReady&&window.__turnstileFixture);
    await browserExpect(page.locator('#contact-verification-status')).toHaveText('Verification unavailable. Please retry.');
    await page.getByRole('button',{name:'Retry verification'}).press('Enter');await waitWidgets(1);expect(loads).toBe(2);
    await page.getByRole('button',{name:'Send',exact:true}).click();await browserExpect(page.locator('#outcome')).toHaveText('invalid');await waitWidgets(2);expect(await audit()).toEqual({mutations:0,requests:0});
    // A forged success event must still be rejected by authoritative Siteverify.
    await emit(1,'success','forged-success');await browserExpect(field).toHaveValue('forged-success');
    await page.getByRole('button',{name:'Send',exact:true}).click();await waitWidgets(3);expect(await audit()).toEqual({mutations:0,requests:1});
    await emit(2,'success','expired');await page.getByRole('button',{name:'Send',exact:true}).click();await waitWidgets(4);expect(await audit()).toEqual({mutations:0,requests:2});
    await emit(3,'success','valid-first');await page.getByRole('button',{name:'Send',exact:true}).press('Enter');await browserExpect(page.locator('#outcome')).toHaveText('submitted');await waitWidgets(5);expect(await audit()).toEqual({mutations:1,requests:3});await browserExpect(field).toHaveValue('');
    await emit(3,'success','valid-stale');await browserExpect(field).toHaveValue('');
    await emit(4,'success','valid-first');await page.getByRole('button',{name:'Send',exact:true}).click();await waitWidgets(6);expect(await audit()).toEqual({mutations:1,requests:4});
    await emit(5,'success','valid-second');await emit(5,'expired');await browserExpect(field).toHaveValue('');await browserExpect(page.locator('#contact-verification-status')).toHaveText('Verification expired. Please retry.');
    await page.getByRole('button',{name:'Retry verification'}).click();await waitWidgets(7);
    await emit(6,'success','valid-second');await emit(6,'error','110200');await browserExpect(field).toHaveValue('');await browserExpect(page.locator('#contact-verification-status')).toHaveText('Verification unavailable. Please retry.');
    await page.getByRole('button',{name:'Retry verification'}).click();await waitWidgets(8);
    await emit(7,'success','valid-second');await page.getByRole('button',{name:'Send',exact:true}).click();await waitWidgets(9);expect(await audit()).toEqual({mutations:2,requests:5});
    await page.locator('#hide-widget').click();await browserExpect(field).toHaveCount(0);expect(await page.evaluate(()=>window.__turnstileMock.widgets[8].removed)).toBe(true);
    await emit(8,'success','valid-after-disposal');expect(await page.evaluate(()=>window.__turnstileFixture.form.getFieldValue('token'))).toBe('');
    await page.locator('#show-widget').click();await waitWidgets(10);await browserExpect(field).toHaveValue('');expect(loads).toBe(2);expect(errors).toEqual([]);
  } finally { await page.close(); }
}
