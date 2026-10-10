import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect } from 'vitest';

const PRIVATE = 'native-dev-private-error-8f92';
const REQUEST_PRIVATE = 'native-dev-private-request-91bd';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Authored runtime failures through the native Cloudflare Vite environment, not mocks. */
export async function verifyCloudflareDevelopmentFaults(root, { allowedPaths = [] } = {}) {
  await fs.mkdir(path.join(root, 'src/pages/api/fault'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/api/fault/[id].ts'), `
    import {defineApi} from '@cossackframework/framework/api';
    export const POST=defineApi({handler:async({c})=>{
      await c.req.json();
      throw new Error('${PRIVATE} /private/customer/storage.ts',{cause:new Error('private nested cause')});
    }});
  `);
  const ssrFile = path.join(root, 'src/pages/fault-ssr.ts');
  const page = body => `import {Cossack,Page,Server} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    @Page({transport:'http'}) export default class FaultPage extends Cossack {
      @Server() private fail(){throw new Error('${PRIVATE} /private/customer/storage.ts');}
      render(){${body}}
    }`;
  await fs.writeFile(ssrFile, page("if(this.isServer)this.fail();return html`<p>unreachable</p>`;"));
  await fs.writeFile(path.join(root, 'src/pages/layout.ts'), "import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';@Page()export default class Layout extends Cossack{render(){return html`${this.children}`;}}\n");
  // Avoid an application error boundary masking the framework's default diagnostic.
  await fs.rm(path.join(root, 'src/pages/error.ts'), { force: true });
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {createServer} from 'vite';
    const server=await createServer({root:${JSON.stringify(root)},logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:${JSON.stringify([root, ...allowedPaths])}}}});
    await server.listen();console.log('FAULT_ORIGIN=http://127.0.0.1:'+server.httpServer.address().port);
    process.on('message',async()=>{await server.close();process.exit(0);});
  `], { cwd: root, env: { ...process.env, NODE_ENV: 'development', VITEST: '', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: true });
  let output = '';
  const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const deadline = setTimeout(killGroup, 110000);
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) killGroup(); });
  const exited = once(child, 'exit').catch(() => undefined);
  try {
    await expect.poll(() => {
      if (spawnFailed) throw new Error('Native development process could not start');
      if (child.exitCode !== null) throw new Error('Native development process exited before readiness');
      return /FAULT_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    }, { timeout: 45000 }).toBeTruthy();
    const origin = /FAULT_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    const start = output.length;
    const api = await fetch(`${origin}/api/fault/${REQUEST_PRIVATE}?secret=${REQUEST_PRIVATE}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Private-Request': REQUEST_PRIVATE },
      body: JSON.stringify({ secret: REQUEST_PRIVATE }), signal: AbortSignal.timeout(20000),
    });
    const apiBody = await api.text();
    expect(api.status).toBe(500);
    const apiId = api.headers.get('X-Cossack-Request-Id');
    expect(apiId).toMatch(UUID);
    expect(JSON.parse(apiBody)).toEqual({ error: 'Internal Server Error', code: 'COSSACK_API_INTERNAL', requestId: apiId });
    const ssr = await fetch(`${origin}/fault-ssr?secret=${REQUEST_PRIVATE}`, { signal: AbortSignal.timeout(20000) });
    const ssrBody = await ssr.text();
    expect(ssr.status).toBe(500);
    const ssrId = ssr.headers.get('X-Cossack-Request-Id');
    expect(ssrId).toMatch(UUID);
    expect(ssrId).not.toBe(apiId);
    expect(ssrBody).toContain('COSSACK_SSR_INTERNAL');
    expect(ssrBody).toContain(ssrId);
    await expect.poll(() => output.slice(start)).toContain(apiId);
    await expect.poll(() => output.slice(start)).toContain(ssrId);
    const failureLog = output.slice(start);
    expect(failureLog).toContain('cossack.api.failure');
    expect(failureLog).toContain('cossack.ssr.failure');
    expect(failureLog).toContain('durationMs');
    const starts = [...failureLog.matchAll(/['"]?event['"]?\s*:\s*['"]cossack\.(api|ssr)\.failure['"]/g)];
    const events = starts.map((match, index) => {
      const segment = failureLog.slice(match.index, starts[index + 1]?.index ?? failureLog.length);
      const string = key => new RegExp(`${key}['"]?\\s*:\\s*(['"])(.*?)\\1`).exec(segment)?.[2];
      const duration = /durationMs['"]?\s*:\s*([0-9.]+)/.exec(segment)?.[1];
      return { kind: match[1], requestId: string('requestId'), route: string('route'), action: string('action'), runtime: string('runtime'), stage: string('stage'), code: string('code'), durationMs: Number(duration) };
    });
    expect(events).toHaveLength(2);
    expect(events.find(event => event.kind === 'api')).toMatchObject({ requestId: apiId, route: '/api/fault/:id', action: 'POST', runtime: 'cloudflare', stage: 'handler', code: 'COSSACK_API_INTERNAL' });
    expect(events.find(event => event.kind === 'ssr')).toMatchObject({ requestId: ssrId, route: '/fault-ssr', action: 'render', runtime: 'cloudflare', stage: 'render', code: 'COSSACK_SSR_INTERNAL' });
    for (const event of events) { expect(Number.isFinite(event.durationMs)).toBe(true); expect(event.durationMs).toBeGreaterThanOrEqual(0); }
    for (const text of [apiBody, ssrBody, failureLog]) {
      expect(text).not.toContain(PRIVATE);
      expect(text).not.toContain(REQUEST_PRIVATE);
      expect(text).not.toContain('/private/customer/storage.ts');
      expect(text).not.toContain('private nested cause');
    }
    await fs.writeFile(ssrFile, page('return html`<p>Native development recovered</p>`;'));
    await expect.poll(async () => {
      const response = await fetch(`${origin}/fault-ssr`, { signal: AbortSignal.timeout(5000) });
      return response.status === 200 && (await response.text()).includes('Native development recovered');
    }, { timeout: 20000 }).toBe(true);
    expect(child.exitCode).toBeNull();
    return { apiCode: 'COSSACK_API_INTERNAL', ssrCode: 'COSSACK_SSR_INTERNAL', apiId, ssrId, recovered: true };
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.connected) child.send('close');
    let timer;
    try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} resolve(); }, 8000); })]); }
    finally { clearTimeout(timer); if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} await exited; } }
  }
}
