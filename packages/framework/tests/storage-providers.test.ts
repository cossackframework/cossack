import { describe, it, expect } from 'vitest';
import { Storage, StorageError } from '@cossackframework/core/storage';
import { createServer } from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
import { createR2StorageProvider, STORAGE_SINGLE_PUT_MAX_BYTES, type R2StorageBucket, type R2StorageMetadata } from '../src/storage/r2';
import { createS3StorageProvider } from '../src/storage/s3-provider';

const bytes=(value:string)=>new TextEncoder().encode(value);
const stream=(value:string)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes(value));c.close();}});
const MiB=1024*1024,SINGLE=STORAGE_SINGLE_PUT_MAX_BYTES;
const PATTERN=new Uint8Array(11*MiB);for(let index=0;index<PATTERN.length;index++)PATTERN[index]=index%251;
const pattern=(size:number)=>PATTERN.subarray(0,size);
/** A deterministic byte source pulled in 64 KiB chunks. */
function sized(size:number){let sent=0;return new ReadableStream<Uint8Array>({pull(c){if(sent>=size){c.close();return;}const length=Math.min(64*1024,size-sent);c.enqueue(PATTERN.slice(sent,sent+length));sent+=length;}});}
/** Byte comparison without deep-equality diffing of megabyte arrays. */
const sameBytes=(actual:unknown,size:number)=>expect(actual instanceof Uint8Array&&Buffer.from(actual).equals(Buffer.from(pattern(size)))).toBe(true);
function bucketFixture() {
 const objects=new Map<string,{data:Uint8Array;meta:R2StorageMetadata}>();let aborted=0,partCalls=0;
 const bucket:R2StorageBucket={
  async put(key,data,options){const meta={key,size:data.length,etag:'fixture',uploaded:new Date(),...options};objects.set(key,{data,meta});return meta;},
  async createMultipartUpload(key,options){const parts:Uint8Array[]=[];return {async uploadPart(partNumber,data){partCalls++;parts.push(data);return {partNumber,etag:'part'};},async complete(){const data=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){data.set(p,offset);offset+=p.length;}return bucket.put(key,data,options).then(v=>v!);},async abort(){aborted++;}};},
  async head(key){return objects.get(key)?.meta??null;},async get(key){const o=objects.get(key);return o?{...o.meta,body:new ReadableStream({start(c){c.enqueue(o.data);c.close();}})}:null;},async delete(key){objects.delete(key);},
 };return {bucket,objects,get aborted(){return aborted;},get partCalls(){return partCalls;}};
}
describe('R2 streamed provider',()=>{
 it('preserves metadata and streams CRUD including empty objects',async()=>{const f=bucketFixture(),p=createR2StorageProvider(f.bucket);expect(await p.put('owner/file',stream('hello'),{size:5,contentType:'text/plain',customMetadata:{owner:'a'}})).toMatchObject({key:'owner/file',size:5,contentType:'text/plain',customMetadata:{owner:'a'}});const read=await p.get('owner/file');expect(await new Response(read!.body).text()).toBe('hello');expect(await p.head('owner/file')).toMatchObject({size:5});await p.put('empty',stream(''),{size:0});expect(await p.head('empty')).toMatchObject({size:0});await p.delete('owner/file');expect(await p.get('owner/file')).toBeNull();
});
 it('publishes no partial replacement on mismatch or source failure',async()=>{const f=bucketFixture(),p=createR2StorageProvider(f.bucket);await p.put('key',stream('old'),{size:3});for(const body of [stream('too long'),stream('x'),new ReadableStream<Uint8Array>({start(c){c.error(new Error('PRIVATE_SOURCE_SECRET'));}})])await expect(p.put('key',body,{size:3})).rejects.toMatchObject({message:expect.not.stringContaining('PRIVATE_SOURCE_SECRET')});expect(await new Response((await p.get('key'))!.body).text()).toBe('old');expect(f.aborted).toBe(0);expect(f.partCalls).toBe(0);});
 it('publishes no partial multipart replacement on mismatch or source failure',async()=>{const f=bucketFixture(),p=createR2StorageProvider(f.bucket),size=SINGLE+3;await p.put('key',stream('old'),{size:3});
  const failing=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(SINGLE));c.error(new Error('PRIVATE_SOURCE_SECRET'));}});
  for(const body of [sized(size+1),sized(size-1),failing])await expect(p.put('key',body,{size})).rejects.toMatchObject({message:expect.not.stringContaining('PRIVATE_SOURCE_SECRET')});
  expect(await new Response((await p.get('key'))!.body).text()).toBe('old');expect(f.aborted).toBe(3);});
 it('redacts even application-supplied StorageError messages',async()=>{const f=bucketFixture(),p=createR2StorageProvider(f.bucket);await expect(p.put('key',new ReadableStream({start(c){c.error(new StorageError('PRIVATE_SECRET_CODE','PRIVATE_SECRET_MESSAGE'));}}),{size:1})).rejects.toMatchObject({code:'COSSACK_STORAGE_PROVIDER_FAILED',message:'Storage provider operation failed.'});});
 it('redacts download stream failures without requiring a signal',async()=>{const f=bucketFixture();f.bucket.get=async key=>({key,size:1,etag:'fixture',uploaded:new Date(),body:new ReadableStream({start(c){c.error(new Error('PRIVATE_DOWNLOAD_SECRET'));}})});const object=await createR2StorageProvider(f.bucket).get('key');await expect(new Response(object!.body).text()).rejects.toMatchObject({code:'COSSACK_STORAGE_PROVIDER_FAILED',message:'Storage provider operation failed.'});});
 it('cancels a blocked source and aborts multipart without publication',async()=>{const f=bucketFixture(),p=createR2StorageProvider(f.bucket),controller=new AbortController();let cancelled=false;const body=new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}});const upload=p.put('key',body,{size:SINGLE+6,signal:controller.signal});setTimeout(()=>controller.abort(),10);await expect(upload).rejects.toMatchObject({code:'COSSACK_STORAGE_ABORTED'});expect(cancelled).toBe(true);expect(f.aborted).toBe(1);expect(await p.head('key')).toBeNull();});
 it('cancels a blocked small source before any provider request',async()=>{const f=bucketFixture(),p=createR2StorageProvider(f.bucket),controller=new AbortController();let cancelled=false,requests=0;const put=f.bucket.put,create=f.bucket.createMultipartUpload;f.bucket.put=(...args)=>{requests++;return put(...args);};f.bucket.createMultipartUpload=(...args)=>{requests++;return create(...args);};const body=new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}});const upload=p.put('key',body,{size:6,signal:controller.signal});setTimeout(()=>controller.abort(),10);await expect(upload).rejects.toMatchObject({code:'COSSACK_STORAGE_ABORTED'});expect(cancelled).toBe(true);expect(requests).toBe(0);expect(await p.head('key')).toBeNull();});
 it('does not await application cancellation promises that never settle',async()=>{
  const f=bucketFixture(),p=createR2StorageProvider(f.bucket),controller=new AbortController();let cancellations=0;
  const source=()=>new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{});},cancel(){cancellations++;return new Promise(()=>{});}});
  const upload=p.put('blocked',source(),{size:1,signal:controller.signal});setTimeout(()=>controller.abort(),10);await expect(upload).rejects.toMatchObject({code:'COSSACK_STORAGE_ABORTED'});expect(cancellations).toBe(1);
  f.bucket.get=async key=>({key,size:1,etag:'fixture',uploaded:new Date(),body:source()});
  const downloadController=new AbortController(),download=(await p.get('read',{signal:downloadController.signal}))!.body.getReader();const reading=download.read();setTimeout(()=>downloadController.abort(),10);await expect(reading).rejects.toMatchObject({code:'COSSACK_STORAGE_ABORTED'});download.releaseLock();
  const cancelReader=(await p.get('direct'))!.body.getReader();const pending=cancelReader.read();await cancelReader.cancel();expect(await pending).toMatchObject({done:true});cancelReader.releaseLock();expect(cancellations).toBe(3);
 },1000);
 it('bounds best-effort multipart cleanup when the provider never settles',async()=>{
  const f=bucketFixture(),create=f.bucket.createMultipartUpload;f.bucket.createMultipartUpload=async(...args)=>({...await create(...args),abort:()=>new Promise(()=>{})});
  const started=Date.now();await expect(createR2StorageProvider(f.bucket).put('key',stream('wrong'),{size:SINGLE+1})).rejects.toMatchObject({code:'COSSACK_STORAGE_SIZE_MISMATCH'});expect(Date.now()-started).toBeLessThan(2600);expect(await f.bucket.head('key')).toBeNull();
 },3000);
 it('sends bodies up to one part in a single put and larger bodies as multipart',async()=>{
  const calls:string[]=[],stored=new Map<string,Uint8Array>();const options:unknown[]=[];
  const bucket:R2StorageBucket={
   async put(key,data,attributes){calls.push(`put:${data.byteLength}`);options.push(attributes);stored.set(key,data);return {key,size:data.byteLength,etag:'single',uploaded:new Date(),...attributes};},
   async createMultipartUpload(key,attributes){calls.push('create');options.push(attributes);const parts:Uint8Array[]=[];return {
    async uploadPart(partNumber,data){calls.push(`part:${data.byteLength}`);parts[partNumber-1]=new Uint8Array(data);return {partNumber,etag:'part'};},
    async complete(list){calls.push(`complete:${list.length}`);const data=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}stored.set(key,data);return {key,size:data.length,etag:'multi',uploaded:new Date(),...attributes};},
    async abort(){calls.push('abort');}};},
   async get(){return null;},async head(){return null;},async delete(){},
  };
  const p=createR2StorageProvider(bucket),attributes={httpMetadata:{contentType:'text/plain'},customMetadata:{owner:'a'}};
  const expected:Record<number,string[]>={0:['put:0'],1:['put:1'],[MiB]:[`put:${MiB}`],[SINGLE]:[`put:${SINGLE}`],[SINGLE+1]:['create',`part:${SINGLE}`,'part:1','complete:2'],[10*MiB]:['create',`part:${5*MiB}`,`part:${5*MiB}`,'complete:2']};
  for(const [size,requests] of Object.entries(expected).map(([size,requests])=>[Number(size),requests] as const)){
   calls.length=0;options.length=0;
   const result=await p.put(`k${size}`,sized(size),{size,contentType:'text/plain',customMetadata:{owner:'a'}});
   expect(calls).toEqual(requests);expect(options).toEqual([attributes]);
   expect(result).toMatchObject({key:`k${size}`,size,etag:size<=SINGLE?'single':'multi',contentType:'text/plain',customMetadata:{owner:'a'}});
   sameBytes(stored.get(`k${size}`),size);
  }
  // The single-put buffer is published only after the source ends with exactly the declared bytes.
  calls.length=0;await expect(p.put('extra',sized(11),{size:10})).rejects.toMatchObject({code:'COSSACK_STORAGE_SIZE_MISMATCH'});expect(calls).toEqual([]);
 });
 it('rejects an undeclared or invalid size before any provider request',async()=>{
  const f=bucketFixture(),p=createR2StorageProvider(f.bucket);let requests=0;const put=f.bucket.put,create=f.bucket.createMultipartUpload;
  f.bucket.put=(...args)=>{requests++;return put(...args);};f.bucket.createMultipartUpload=(...args)=>{requests++;return create(...args);};
  for(const size of [undefined,Number.NaN,-1,1.5,Number.MAX_SAFE_INTEGER])await expect(p.put('key',stream('abc'),{size:size as number})).rejects.toMatchObject({code:'COSSACK_STORAGE_SIZE_MISMATCH'});
  expect(requests).toBe(0);expect(f.aborted).toBe(0);
 });
 it('uploads bounded parts before the entire source has been pulled',async()=>{const f=bucketFixture(),p=createR2StorageProvider(f.bucket);let pulls=0;const body=new ReadableStream<Uint8Array>({pull(c){pulls++;if(pulls<=4)c.enqueue(new Uint8Array(5*1024*1024));else c.close();}}, {highWaterMark:0});const original=f.bucket.createMultipartUpload;f.bucket.createMultipartUpload=async(...args)=>{const upload=await original(...args),part=upload.uploadPart;upload.uploadPart=async(...partArgs)=>{expect(partArgs[1].length).toBeLessThanOrEqual(5*1024*1024);if(partArgs[0]===1)expect(pulls).toBe(1);return part(...partArgs);};return upload;};await p.put('large',body,{size:20*1024*1024});expect(f.partCalls).toBe(4);});
});

describe('S3 upload strategy',()=>{
 function recordingClient(){
  const commands:{name:string;input:Record<string,unknown>}[]=[];
  const client={async send(command:{constructor:{name:string};input:Record<string,unknown>}){const name=command.constructor.name.replace(/Command$/,'');commands.push({name,input:command.input});return name==='CreateMultipartUpload'?{UploadId:'upload'}:{ETag:`"${name}"`};}};
  return {commands,provider:createS3StorageProvider({client:client as unknown as S3Client,bucket:'bucket'})};
 }
 it('sends one PutObject for bodies up to one part and multipart for larger bodies',async()=>{
  const expected:Record<number,string[]>={0:['PutObject'],1:['PutObject'],[MiB]:['PutObject'],[SINGLE]:['PutObject'],[SINGLE+1]:['CreateMultipartUpload','UploadPart','UploadPart','CompleteMultipartUpload'],[10*MiB]:['CreateMultipartUpload','UploadPart','UploadPart','CompleteMultipartUpload']};
  for(const [size,names] of Object.entries(expected).map(([size,names])=>[Number(size),names] as const)){
   const {commands,provider}=recordingClient();
   const result=await provider.put('owner/file',sized(size),{size,contentType:'text/plain',customMetadata:{owner:'a'}});
   expect(commands.map(command=>command.name)).toEqual(names);
   expect(commands[0].input).toMatchObject({Bucket:'bucket',Key:'owner/file',ContentType:'text/plain',Metadata:{owner:'a'}});
   expect(result).toEqual({key:'owner/file',size,etag:size<=SINGLE?'"PutObject"':'"CompleteMultipartUpload"',contentType:'text/plain',customMetadata:{owner:'a'}});
   if(size<=SINGLE){expect(commands[0].input.ContentLength).toBe(size);sameBytes(commands[0].input.Body,size);}
   else expect(commands.filter(command=>command.name==='UploadPart').map(command=>command.input.ContentLength)).toEqual(size===SINGLE+1?[SINGLE,1]:[5*MiB,5*MiB]);
  }
 });
 it('rejects mismatched or undeclared sizes before any request',async()=>{
  const {commands,provider}=recordingClient();
  await expect(provider.put('key',sized(11),{size:10})).rejects.toMatchObject({code:'COSSACK_STORAGE_SIZE_MISMATCH'});
  await expect(provider.put('key',sized(9),{size:10})).rejects.toMatchObject({code:'COSSACK_STORAGE_SIZE_MISMATCH'});
  await expect(provider.put('key',sized(3),{size:undefined as unknown as number})).rejects.toMatchObject({code:'COSSACK_STORAGE_SIZE_MISMATCH'});
  expect(commands).toEqual([]);
 });
});

it('presigns a PutObject whose content type and length the browser must send',async()=>{
 const config={endpoint:'https://s3.test',region:'us-east-1',credentials:{accessKeyId:'fixture',secretAccessKey:'PRIVATE_TEST_SECRET'},forcePathStyle:true} as const;
 // The default client signs a checksum of an empty body into the URL; presigning refuses it.
 await expect(createS3StorageProvider({client:new S3Client(config),bucket:'bucket'}).presign!('key',{size:1,expiresIn:60})).rejects.toMatchObject({code:'COSSACK_STORAGE_CONFIG_INVALID'});
 const client=new S3Client({...config,requestChecksumCalculation:'WHEN_REQUIRED'});
 const p=createS3StorageProvider({client,bucket:'bucket'});
 const upload=await p.presign!('owner/file name',{size:5,contentType:'text/plain',customMetadata:{owner:'a'},expiresIn:60});
 const url=new URL(upload.url);
 expect(url.origin+url.pathname).toBe('https://s3.test/bucket/owner/file%20name');
 expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
 expect(url.searchParams.get('X-Amz-SignedHeaders')!.split(';').sort()).toEqual(['content-length','content-type','host']);
 expect(url.searchParams.get('x-amz-meta-owner')).toBe('a');
 expect([...url.searchParams.keys()].some(name=>name.includes('checksum'))).toBe(false);
 expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
 expect(upload.url).not.toContain('PRIVATE_TEST_SECRET');
 expect(upload).toEqual({url:upload.url,method:'PUT',headers:{'content-length':'5','content-type':'text/plain'}});
 await expect(p.presign!('key',{size:-1,expiresIn:60})).rejects.toMatchObject({code:'COSSACK_STORAGE_ACCESS_INVALID'});
 await expect(p.presign!('key',{size:1,expiresIn:0})).rejects.toMatchObject({code:'COSSACK_STORAGE_ACCESS_INVALID'});
});
it('uses the real S3 SDK against a loopback multipart protocol endpoint',async()=>{
 const objects=new Map<string,{body:Buffer;type:string;metadata:string}>(),uploads=new Map<string,{key:string;parts:Buffer[];type:string;metadata:string}>();let next=0,abortCount=0,requests=0;
 const server=createServer(async(req,res)=>{requests++;const url=new URL(req.url!,'http://localhost'),key=decodeURIComponent(url.pathname),uploadId=url.searchParams.get('uploadId');const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks);res.setHeader('content-type','application/xml');
  if(req.method==='POST'&&url.searchParams.has('uploads')){const id=String(++next);uploads.set(id,{key,parts:[],type:String(req.headers['content-type']),metadata:String(req.headers['x-amz-meta-owner']??'')});res.end(`<InitiateMultipartUploadResult><Bucket>bucket</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);}
  else if(req.method==='PUT'&&uploadId){uploads.get(uploadId)!.parts[Number(url.searchParams.get('partNumber'))-1]=body;res.setHeader('etag','"part"');res.end();}
  else if(req.method==='POST'&&uploadId){const u=uploads.get(uploadId)!;objects.set(u.key,{body:Buffer.concat(u.parts),type:u.type,metadata:u.metadata});uploads.delete(uploadId);res.end('<CompleteMultipartUploadResult><ETag>"complete"</ETag></CompleteMultipartUploadResult>');}
  else if(req.method==='DELETE'&&uploadId){uploads.delete(uploadId);abortCount++;res.statusCode=204;res.end();}
  else if(req.method==='PUT'){objects.set(key,{body,type:String(req.headers['content-type']),metadata:String(req.headers['x-amz-meta-owner']??'')});res.setHeader('etag','"single"');res.end();}
  else if(req.method==='DELETE'){objects.delete(key);res.statusCode=204;res.end();}
  else {const value=objects.get(key);if(!value){res.statusCode=404;res.end('<Error><Code>NoSuchKey</Code></Error>');}else{res.setHeader('content-length',value.body.length);res.setHeader('content-type',value.type);res.setHeader('x-amz-meta-owner',value.metadata);res.setHeader('etag','"complete"');res.end(req.method==='HEAD'?undefined:value.body);}}
 });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address() as {port:number};const client=new S3Client({endpoint:`http://127.0.0.1:${address.port}`,region:'us-east-1',credentials:{accessKeyId:'fixture',secretAccessKey:'PRIVATE_TEST_SECRET'},forcePathStyle:true,maxAttempts:1});
 try {const p=createS3StorageProvider({client,bucket:'bucket'});let before=requests;expect(await p.put('owner/file',stream('hello'),{size:5,contentType:'text/plain',customMetadata:{owner:'a'}})).toMatchObject({size:5,etag:'"single"'});expect(requests-before).toBe(1);expect(await p.head('owner/file')).toMatchObject({size:5,contentType:'text/plain',customMetadata:{owner:'a'}});expect(await new Response((await p.get('owner/file'))!.body).text()).toBe('hello');
 before=requests;await expect(p.put('owner/file',stream('invalid'),{size:5})).rejects.toMatchObject({code:'COSSACK_STORAGE_SIZE_MISMATCH'});expect(requests).toBe(before);expect(await new Response((await p.get('owner/file'))!.body).text()).toBe('hello');
 const large=SINGLE+5;before=requests;expect(await p.put('owner/large',sized(large),{size:large,contentType:'text/plain',customMetadata:{owner:'a'}})).toMatchObject({size:large,etag:'"complete"'});expect(requests-before).toBe(4);expect(await p.head('owner/large')).toMatchObject({size:large,contentType:'text/plain',customMetadata:{owner:'a'}});sameBytes(new Uint8Array(await new Response((await p.get('owner/large'))!.body).arrayBuffer()),large);
 await expect(p.put('owner/large',sized(large-1),{size:large})).rejects.toMatchObject({code:'COSSACK_STORAGE_SIZE_MISMATCH'});expect(abortCount).toBe(1);expect(uploads.size).toBe(0);expect((await p.head('owner/large'))?.size).toBe(large);
 for(const size of [5,large]){const cancelled=new AbortController();const upload=p.put('cancelled',new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{});}}),{size,signal:cancelled.signal});setTimeout(()=>cancelled.abort(),30);await expect(upload).rejects.toMatchObject({code:'COSSACK_STORAGE_ABORTED'});expect(await p.head('cancelled')).toBeNull();expect(uploads.size).toBe(0);}expect(abortCount).toBe(2);await p.put('empty',stream(''),{size:0});expect(await p.head('empty')).toMatchObject({size:0});await p.delete('owner/file');expect(await p.get('owner/file')).toBeNull();
 const storage=new Storage<string>({provider:p,authorize:({context,key})=>key.startsWith(context+'/'),signing:{endpoint:`http://127.0.0.1:${address.port}/access`,secret:'fixture-storage-secret-0123456789abcdef'}});
 await storage.put('alice','alice/file',stream('hello'),{size:5,contentType:'text/plain'});const prior=requests;
 await expect(storage.get('bob','alice/file')).rejects.toMatchObject({code:'COSSACK_STORAGE_FORBIDDEN'});await expect(storage.delete('bob','alice/file')).rejects.toMatchObject({code:'COSSACK_STORAGE_FORBIDDEN'});expect(requests).toBe(prior);
 const url=await storage.signedUrl('alice','alice/file','get',{expiresIn:1});expect((await storage.handleSignedRequest('bob',new Request(url))).status).toBe(403);expect(await (await storage.handleSignedRequest('alice',new Request(url))).text()).toBe('hello');await new Promise(r=>setTimeout(r,1100));const count=requests;expect((await storage.handleSignedRequest('alice',new Request(url))).status).toBe(410);expect(requests).toBe(count);
 }
 finally {client.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);
