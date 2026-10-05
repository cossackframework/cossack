import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';

export async function writeStorageAcceptance(root) {
 await fs.writeFile(path.join(root,'worker.ts'),`
import { Storage, StorageError } from '@cossackframework/core/storage';
import { createR2StorageProvider, type R2StorageBucket } from '@cossackframework/framework/storage/r2';
export default {async fetch(request:Request,env:{FILES:R2StorageBucket}) {
 const url=new URL(request.url),user=request.headers.get('x-user')??'anonymous',key=url.searchParams.get('key')??'alice/file';
 const storage=new Storage<string>({provider:createR2StorageProvider(env.FILES),authorize:({context,key})=>key.startsWith(context+'/'),maxBytes:32*1024*1024,contentTypes:['text/plain'],signing:{secret:'fixture-storage-secret-0123456789abcdef',endpoint:url.origin+'/access'}});
 if(url.pathname==='/access')return storage.handleSignedRequest(user,request);
 try {
  if(url.searchParams.get('op')==='sign')return Response.json({url:await storage.signedUrl(user,key,url.searchParams.get('method')==='put'?'put':'get',{expiresIn:1,size:5,contentType:'text/plain'})});
  if(url.searchParams.get('op')==='cancel') {
   const controller=new AbortController();let pulls=0;
   const body=new ReadableStream<Uint8Array>({pull(c){if(++pulls===1)c.enqueue(new Uint8Array(5*1024*1024));else controller.abort();}});
   await storage.put(user,key,body,{size:10*1024*1024,contentType:'text/plain',signal:controller.signal});return Response.json({unexpected:true});
  }
  if(request.method==='PUT') {const progress:number[]=[];const value=await storage.put(user,key,request.body!,{size:Number(request.headers.get('x-size')),contentType:request.headers.get('content-type')??undefined,customMetadata:{owner:user},onProgress:p=>progress.push(p.transferred)});return Response.json({value,progress});}
  if(request.method==='HEAD'){const value=await storage.head(user,key);return new Response(null,{status:value?200:404,headers:value?{'x-size':String(value.size),'x-owner':value.customMetadata?.owner??'','content-type':value.contentType??''}:undefined});}
  if(request.method==='DELETE'){await storage.delete(user,key);return new Response(null,{status:204});}
  const object=await storage.get(user,key);return object?new Response(object.body,{headers:{'content-type':object.contentType??'application/octet-stream','x-size':String(object.size)}}):new Response(null,{status:404});
 }catch(error){return Response.json({code:error instanceof StorageError?error.code:'COSSACK_STORAGE_PROVIDER_FAILED'},{status:error instanceof StorageError&&error.code==='COSSACK_STORAGE_FORBIDDEN'?403:400});}
}};
`);
 await fs.writeFile(path.join(root,'wrangler.jsonc'),JSON.stringify({name:'storage-acceptance',main:'worker.ts',compatibility_date:'2026-07-29',r2_buckets:[{binding:'FILES',bucket_name:'storage-acceptance-local'}]}));
}
export async function checkStorageAcceptance(request) {
 const call=(path,options={})=>request(path,{...options,headers:{'x-user':'alice',...options.headers}});
 let result=await call('/?key=alice/file',{method:'PUT',headers:{'x-size':'5','content-type':'text/plain'},body:'hello'});expect(result.status,await result.clone().text()).toBe(200);expect(await result.json()).toMatchObject({value:{key:'alice/file',size:5,contentType:'text/plain',customMetadata:{owner:'alice'}},progress:[5]});
 expect(await (await call('/?key=alice/file')).text()).toBe('hello');const head=await call('/?key=alice/file',{method:'HEAD'});expect(head.status).toBe(200);expect(head.headers.get('x-size')).toBe('5');expect(head.headers.get('x-owner')).toBe('alice');
 expect((await call('/?key=alice/file',{headers:{'x-user':'bob'}})).status).toBe(403);expect((await call('/?key=alice/file',{method:'DELETE',headers:{'x-user':'bob'}})).status).toBe(403);
 const download=(await (await call('/?op=sign&key=alice/file')).json()).url;expect((await call(download,{headers:{'x-user':'bob'}})).status).toBe(403);expect(await (await call(download)).text()).toBe('hello');
 await new Promise(r=>setTimeout(r,1100));expect((await call(download)).status).toBe(410);
 const upload=(await (await call('/?op=sign&method=put&key=alice/signed')).json()).url;expect((await call(upload,{method:'PUT',headers:{'x-user':'bob'},body:'hello'})).status).toBe(403);expect((await call(upload,{method:'PUT',body:'hello'})).status).toBe(201);expect(await (await call('/?key=alice/signed')).text()).toBe('hello');
 expect(await (await call('/?op=cancel&key=alice/file')).json()).toMatchObject({code:'COSSACK_STORAGE_ABORTED'});expect(await (await call('/?key=alice/file')).text()).toBe('hello');
 expect((await call('/?key=alice/bad-type',{method:'PUT',headers:{'x-size':'5','content-type':'application/json'},body:'hello'})).status).toBe(400);expect((await call('/?key=alice/bad-type')).status).toBe(404);
 const large=20*1024*1024;let sent=0;const body=new ReadableStream({pull(c){if(sent===large)c.close();else{sent+=1024*1024;c.enqueue(new Uint8Array(1024*1024).fill(65));}}});result=await call('/?key=alice/large',{method:'PUT',headers:{'x-size':String(large),'content-type':'text/plain'},body,duplex:'half'});expect(result.status,await result.clone().text()).toBe(200);const receipt=await result.json();expect(receipt.value.size).toBe(large);expect(receipt.progress.at(-1)).toBe(large);let received=0;const reader=(await call('/?key=alice/large')).body.getReader();while(true){const chunk=await reader.read();if(chunk.done)break;received+=chunk.value.byteLength;expect(chunk.value[0]).toBe(65);}expect(received).toBe(large);
 expect((await call('/?key=alice/file',{method:'DELETE'})).status).toBe(204);expect((await call('/?key=alice/file')).status).toBe(404);
}
