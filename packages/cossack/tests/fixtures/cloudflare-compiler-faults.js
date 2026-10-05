import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect } from 'vitest';

const PRIVATE = 'PRIVATE_COMPILER_SECRET_8672';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A real malformed authored page compiled by Vite's Cloudflare environment. */
export async function verifyCloudflareCompilerFaults(root, { allowedPaths = [] } = {}) {
  const filename = path.join(root, 'src/pages/compiler-fault.ts');
  const valid = `import {Cossack,Page,Server} from '@cossackframework/core';
import {html} from '@cossackframework/renderer';
@Page({transport:'http'}) export default class CompilerPage extends Cossack {
 @Server() private compilerOnly(){return 'unused';}
 render(){return html\`<p>Compiler native recovery passed</p>\`;}
}`;
  const malformed = valid.replace("@Server() private compilerOnly(){return 'unused';}", `@Server() private compilerOnly(){const secret='${PRIVATE}';const broken=;return secret;}`);
  await fs.writeFile(filename, valid);
  await fs.writeFile(path.join(root,'src/pages/layout.ts'), "import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';@Page()export default class Layout extends Cossack{render(){return html`${this.children}`;}}\n");
  await fs.rm(path.join(root,'src/pages/error.ts'), {force:true});
  const child = spawn(process.execPath, ['--input-type=module','-e', `
import {createServer} from 'vite';
const server=await createServer({root:${JSON.stringify(root)},logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:${JSON.stringify([root,...allowedPaths])}}}});
await server.listen();console.log('COMPILER_ORIGIN=http://127.0.0.1:'+server.httpServer.address().port);
process.on('message',async()=>{await server.close();process.exit(0);});
`], {cwd:root,env:{...process.env,NODE_ENV:'development',VITEST:'',WRANGLER_SEND_METRICS:'false',WRANGLER_SEND_ERROR_REPORTS:'false',CLOUDFLARE_CF_FETCH_ENABLED:'false',WRANGLER_LOG_PATH:path.join(root,'compiler-private.log')},stdio:['ignore','pipe','pipe','ipc'],detached:process.platform!=='win32'});
  let output='';
  const kill=()=>{try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{}};
  const timer=setTimeout(kill,110000);
  let spawnFailed=false;
  child.on('error',()=>{spawnFailed=true;});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;if(output.length>1024*1024)kill();});
  const exited=once(child,'exit').catch(()=>undefined);
  try {
    await expect.poll(()=>{
      if(spawnFailed||child.exitCode!==null)throw new Error('Native compiler process failed before readiness');
      return /COMPILER_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    },{timeout:45000}).toBeTruthy();
    const origin=/COMPILER_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    const healthy=await fetch(`${origin}/compiler-fault`,{signal:AbortSignal.timeout(20000)});
    expect(healthy.status).toBe(200);
    expect(await healthy.text()).toContain('Compiler native recovery passed');
    await fs.writeFile(filename,malformed);
    let response;
    await expect.poll(async()=>{response=await fetch(`${origin}/compiler-fault`,{signal:AbortSignal.timeout(10000)});if(response.status!==500)await response.text();return response.status;},{timeout:20000}).toBe(500);
    const body=await response.text();
    expect(response.status).toBe(500);
    const requestId=response.headers.get('X-Cossack-Request-Id');
    expect(requestId).toMatch(UUID);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(body).toContain('COSSACK_RUNTIME_FAILED');
    expect(JSON.parse(body)).toEqual({error:'Internal Server Error',code:'COSSACK_RUNTIME_FAILED',requestId});
    await expect.poll(()=>output).toContain(requestId);
    const event = /event:\s*['"]cossack\.runtime\.failure['"]([\s\S]*?)\n\}/.exec(output)?.[1];
    expect(event).toBeTruthy();
    expect(event).toContain(requestId);
    expect(event).toContain("runtime: 'cloudflare'");
    expect(event).toContain("route: 'unknown'");
    expect(event).toContain("action: 'unknown'");
    expect(event).toContain("stage: 'dispatch'");
    expect(event).toContain("code: 'COSSACK_RUNTIME_FAILED'");
    expect(event).not.toContain(PRIVATE);
    const duration = Number(/durationMs:\s*([0-9.]+)/.exec(event)?.[1]);
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(body).not.toContain(PRIVATE);
    expect(body).not.toContain(filename);
    await expect.poll(()=>output,{timeout:10000}).toContain('compiler-fault.ts');
    expect(output).toMatch(/(Unexpected|Expression expected|Parse error|Expected|Transform failed)/i);
    // Trusted developer compiler diagnostics intentionally retain the authored source.
    expect(output.replace(/\u001b\[[0-9;]*m/g,'')).toContain(PRIVATE);
    await fs.writeFile(filename,valid);
    await expect.poll(async()=>{
      const recovered=await fetch(`${origin}/compiler-fault`,{signal:AbortSignal.timeout(5000)});
      return recovered.status===200&&(await recovered.text()).includes('Compiler native recovery passed');
    },{timeout:20000}).toBe(true);
    expect(child.exitCode).toBeNull();
    return {recovered:true,code:'COSSACK_RUNTIME_FAILED',privateCompilerDiagnostic:true};
  } finally {
    await fs.writeFile(path.join(root,'compiler-terminal.log'),output,{mode:0o600});
    clearTimeout(timer);
    if(child.exitCode===null&&child.connected)child.send('close');
    let cleanup;
    try{await Promise.race([exited,new Promise(resolve=>{cleanup=setTimeout(()=>{kill();resolve();},8000);})]);}
    finally{clearTimeout(cleanup);if(child.exitCode===null){kill();await exited;}}
  }
}
