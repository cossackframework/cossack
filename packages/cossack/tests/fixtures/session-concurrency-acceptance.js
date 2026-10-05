import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';

export async function writeSessionConcurrencyAcceptance(root) {
  // Fixture-owned declarative equivalents of the generated SQLite auth schema.
  // Legacy callback plans intentionally remain incomplete; never execute them to plan.
  for (const file of await fs.readdir(path.join(root,'src/migrations'))) {
    if(file==='index.ts') continue;
    const filename=path.join(root,'src/migrations',file),source=await fs.readFile(filename,'utf8');
    const up=source.slice(source.indexOf('up('),source.indexOf('down('));
    const statements=[...up.matchAll(/orm\.sql\.unsafe\(\s*(`[^`]*`|'[^']*')/g)].map(match=>match[1].slice(1,-1));
    expect(statements.length,file).toBeGreaterThan(0);
    await fs.writeFile(filename,`import { sql, type Migration } from '@cossackframework/database';\nexport default {name:${JSON.stringify(file.replace('.ts',''))},operations:{up:[${statements.map(text=>'sql.unsafe('+JSON.stringify(text)+')').join(',')}],down:[]}} satisfies Migration;\n`);
  }
  const middleware=path.join(root,'src/bootstrap/middlewares.ts');
  let content=await fs.readFile(middleware,'utf8');
  content="import { sessionMiddleware } from '../middlewares/orm';\n"+content.replace('ormRequestMiddleware,','ormRequestMiddleware, sessionMiddleware,');
  await fs.writeFile(middleware,content);
  await fs.mkdir(path.join(root,'src/pages/api'),{recursive:true});
  await fs.writeFile(path.join(root,'src/pages/api/concurrency.ts'),`
import { defineApi } from '@cossackframework/framework/api';
import { session } from '@cossackframework/framework/session';
import { input as schema, flash, flashed } from '@cossackframework/core';
import { sql } from '@cossackframework/database';
import { getCookie } from 'hono/cookie';
import { authSessions, registerUser } from '../../auth';
export const POST = defineApi({input:{body:schema.object({op:schema.string(),id:schema.string(),value:schema.string()})},handler:async({input,c})=>{
 const {op,id,value}=input.body; const token=getCookie(c,authSessions.cookieName)??'';
 if(op==='setup') { await sql\`\${sql.unsafe('CREATE TABLE IF NOT EXISTS concurrency_barriers (id TEXT PRIMARY KEY, released INTEGER NOT NULL DEFAULT 0)')}\`; return c.json(await session().getAll()); }
 if(op==='ready') { const rows=await sql\`SELECT id FROM concurrency_barriers WHERE id=\${id}\`; return c.json({ready:rows.rows.length===1}); }
 if(op==='release') {await sql\`UPDATE concurrency_barriers SET released=1 WHERE id=\${id}\`;return c.json({ok:true});}
 if(op==='read') return c.json(await session().getAll());
 if(op==='login') {const user=await registerUser('concurrency-'+crypto.randomUUID()+'@example.invalid','fixture-password','Fixture');const created=await authSessions.create(user.id,c);created.headers.forEach((v,k)=>c.header(k,v));return c.json({ok:true,userId:user.id});}
 if(op==='rotate') {const result=await authSessions.rotate(token,c);if(!result)return c.json({ok:false},409);result.headers.forEach((v,k)=>c.header(k,v));return c.json({ok:true});}
 if(op==='revoke') {const headers=await authSessions.revoke(token,c);headers.forEach((v,k)=>c.header(k,v));return c.json({ok:true});}
 if(op==='valid') return c.json({valid:!!await authSessions.validate(token,c)});
 if(op==='flash') {flash('notice','once');return c.redirect('/api/concurrency',303);}
 if(op==='consume') return c.json({notice:flashed('notice')??null});
 if(op==='write'||op==='protected'||op==='bind') {
   const admitted=!!c.get('user');if(op==='protected'&&!admitted)return c.json({admitted:false},401);
   const before=await session().getAll();
   await sql\`INSERT INTO concurrency_barriers (id) VALUES (\${id})\`;
   const deadline=Date.now()+10000;
   while(true){const rows=await sql\`SELECT released FROM concurrency_barriers WHERE id=\${id}\`;if(rows.rows[0]?.released===1)break;if(Date.now()>deadline)throw new Error('Fixture barrier timeout');await new Promise(r=>setTimeout(r,10));}
   if(op==='bind') await session().bindUser(value); else await session().set(op==='protected'?'admitted':value,id);
   return c.json({before,admitted,valid:!!await authSessions.validate(token,c)});
 }
 return c.json({error:'fixture operation'},400);
}});
`);
}

export async function checkSessionConcurrency(request) {
 const call=(op,id='',value='',cookie='')=>request('/api/concurrency',{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({op,id,value})});
 const cookies=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]);
 const setup=await call('setup');expect(setup.status,await setup.clone().text()).toBe(200);
 const bag=cookies(setup).find(v=>v.startsWith('cossack_sid='));expect(bag).toBeTruthy();
 const ready=async id=>expect.poll(async()=>{const r=await call('ready',id,'',bag);return (await r.json()).ready;},{timeout:8000}).toBe(true);
 const release=async id=>expect((await call('release',id,'',bag)).status).toBe(200);
 const a=call('write','first','left',bag),b=call('write','second','right',bag);await ready('first');await ready('second');await release('first');await release('second');expect((await a).status).toBe(200);expect((await b).status).toBe(200);
 expect(await (await call('read','','',bag)).json()).toMatchObject({left:'first',right:'second'});
 const c=call('write','third','same',bag),d=call('write','fourth','same',bag);await ready('third');await ready('fourth');await release('third');expect((await c).status).toBe(200);await release('fourth');expect((await d).status).toBe(200);
 expect(await (await call('read','','',bag)).json()).toMatchObject({same:'fourth',left:'first',right:'second'});
 const login=await call('login','','',bag);expect(login.status,await login.clone().text()).toBe(200);const userId=(await login.clone().json()).userId;const auth=cookies(login).find(v=>v.startsWith('session_id='));expect(auth).toBeTruthy();
 const old=bag+'; '+auth;const rotations=await Promise.all([call('rotate','','',old),call('rotate','','',old)]);expect(rotations.map(r=>r.status).sort()).toEqual([200,409]);
 const winner=bag+'; '+cookies(rotations.find(r=>r.status===200)).find(v=>v.startsWith('session_id='));
 expect(await (await call('valid','','',old)).json()).toEqual({valid:false});expect(await (await call('valid','','',winner)).json()).toEqual({valid:true});
 const issue=await call('flash','','',bag);expect(issue.status).toBe(303);const signed=cookies(issue).find(v=>v.startsWith('cossack_flash='));expect(signed).toBeTruthy();
 const notices=await Promise.all([call('consume','','',bag+'; '+signed),call('consume','','',bag+'; '+signed)]);expect((await Promise.all(notices.map(r=>r.json()))).map(v=>v.notice).sort()).toEqual(['once',null].sort());expect(await (await call('consume','','',bag+'; '+signed)).json()).toEqual({notice:null});
 const flight=call('protected','flight','',winner);await ready('flight');expect((await call('revoke','','',winner)).status).toBe(200);expect(await (await call('valid','','',winner)).json()).toEqual({valid:false});await release('flight');expect(await (await flight).json()).toMatchObject({admitted:true,valid:false});expect((await call('protected','later','',winner)).status).toBe(401);expect(await (await call('read','','',bag)).json()).toMatchObject({admitted:'flight'}); const upgradeA=call('bind','upgrade-a',userId,bag),upgradeB=call('bind','upgrade-b',userId,bag);await ready('upgrade-a');await ready('upgrade-b');await release('upgrade-a');const upgradedA=await upgradeA;await release('upgrade-b');const upgradedB=await upgradeB;expect(upgradedA.status).toBe(200);expect(upgradedB.status).toBe(200);const replacementA=cookies(upgradedA).find(v=>v.startsWith('cossack_sid=')),replacementB=cookies(upgradedB).find(v=>v.startsWith('cossack_sid='));expect(replacementA).toBeTruthy();expect(replacementB).toBeTruthy();expect(replacementA).not.toBe(replacementB);expect(cookies(await call('setup','','',replacementA))).toEqual([]);expect(cookies(await call('setup','','',replacementB))).toEqual([]);

}
