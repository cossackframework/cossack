import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

let directory;
let server;
const sockets = [];
afterEach(async ({ task }) => {
  if (task.result?.state === 'fail') server?.debug();
  for (const socket of sockets.splice(0)) socket.close();
  await server?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('keeps Cloudflare socket peer context and shared limits across reconnects and Workers', async () => {
  vi.stubEnv('WRANGLER_SEND_METRICS', 'false');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-ws-peer-'));
  const core = fileURLToPath(new URL('../../core/dist/index.js', import.meta.url));
  const proxy = fileURLToPath(new URL('../../framework/src/transports/websocket.ts', import.meta.url));
  const hono = fileURLToPath(new URL('../../../node_modules/hono/dist/index.js', import.meta.url));
  const auth = fileURLToPath(new URL('../../auth/src/index.ts', import.meta.url));
  const main = path.join(directory, 'worker.ts');
  await fs.writeFile(main, `
    import { Hono } from ${JSON.stringify(hono)};
    import { Cossack, CossackDurableObject, Page, Server, State, RateLimit,
      RateLimitDurableObject, enforceMethodRateLimit, input, ClientVisibleError, ActionValidationError } from ${JSON.stringify(core)};
    import { createResourcePolicy } from ${JSON.stringify(auth)};
    import { handleWebSocketProxy } from ${JSON.stringify(proxy)};
    export { RateLimitDurableObject };
    const componentPath = '/src/pages/live/index.ts';
    const records = [{id:1,owner:'member',tenant:'t1'},{id:2,owner:'second',tenant:'t1'},{id:3,owner:'member',tenant:'t2'}];
    const policy = createResourcePolicy<{id:number;owner:string;tenant:string},{id:string;tenant:string}>()({
      edit:({user,resource})=>user.id===resource.owner && user.tenant===resource.tenant,
    });
    // Test-only observability for explicit socket cancellation; never app auth state.
    const schemaCallbacks={started:0,aborted:0};
    const schema=input.object({count:input.number({coerce:true,integer:true}),enabled:input.boolean({coerce:true}),
      when:input.date({coerce:true}),kind:input.literal('record'),status:input.enum(['draft','published']),
      note:input.string().optional(),nullable:input.string().nullable(),
      nested:input.object({tags:input.array(input.enum(['small','large']))}),
    }).refine(async(value,{signal})=>{
      if(value.count===14)throw new Error('PRIVATE_SOCKET_SCHEMA_FAILURE');
      if(value.count===15)return 'invalid decision' as any;
      if(value.count===17)throw new ClientVisibleError('PRIVATE_SOCKET_SCHEMA_FAILURE');
      if(value.count===18)throw new ActionValidationError({secret:'PRIVATE_SOCKET_SCHEMA_FAILURE'});
      if(value.count===16){schemaCallbacks.started++;await new Promise<void>(resolve=>{
        signal!.addEventListener('abort',()=>{schemaCallbacks.aborted++;resolve();},{once:true});
        if(signal!.aborted)resolve();
      });}
      return value.count!==13;
    },'Disallowed count.');
    class Live extends Cossack {
      count = 0;
      render() { return null; }
      limited() { return ++this.count; }
      custom() { return ++this.count; }
      edit(value) { ++this.count; return value.id; }
      parsed=(value)=>{++this.count;return {count:value.count,enabled:value.enabled,when:value.when,
        whenIsDate:value.when instanceof Date,kind:value.kind,status:value.status,note:value.note,nullable:value.nullable,nested:value.nested};};
      policyException=(value)=>{++this.count;return value.count;};
      inspect() {
        return { user: this.user?.id ?? null, contextUser: this.c.get('user')?.id ?? null,
          ip: this.c.req.header('cf-connecting-ip'), bucket: this.c.req.header('x-bucket'),
          cookie: this.c.req.header('cookie') ?? null, authorization: this.c.req.header('authorization') ?? null,
          tenant: this.c.req.param('tenant'), filter: this.c.req.query('filter'), path: this.c.req.path,
          marker: this.c.env.MARK, count: this.count };
      }
      async *observe() {
        yield this.inspect();
        await new Promise(resolve => setTimeout(resolve, 5));
        return this.inspect();
      }
    }
    State()(Live.prototype, 'count');
    // The proxy binds socket targets to the page identity. A custom scope lets
    // the test address several Durable Objects for the same page.
    Page({ transport: 'websocket', stateful: true, scope: c => 'object:' + (c.req.query('object') || 'shared') })(Live);
    Reflect.defineMetadata('cossack:durable-object-name', 'COSSACK_OBJECT', Live);
    for (const name of ['limited', 'custom', 'inspect', 'observe'])
      Server()(Live.prototype, name, Object.getOwnPropertyDescriptor(Live.prototype, name));
    Server({input:input.object({id:input.number({coerce:true,integer:true,min:1})}),
      authorize:policy.action('edit',(value:{id:number})=>records.find(record=>record.id===value.id))})
      (Live.prototype,'edit',Object.getOwnPropertyDescriptor(Live.prototype,'edit'));
    Server({input:schema})(Live.prototype,'parsed');
    Server({input:schema,authorize:()=>{throw new ClientVisibleError('PRIVATE_SOCKET_POLICY_FAILURE');}})(Live.prototype,'policyException');
    RateLimit({ max: 1, window: 60000, requires: { shared: true, durable: true, atomicIncrement: true } })(Live.prototype, 'limited', Object.getOwnPropertyDescriptor(Live.prototype, 'limited'));
    RateLimit({ max: 1, window: 60000, key: c => JSON.stringify([c.req.param('tenant'), c.req.header('x-bucket')]) })
      (Live.prototype, 'custom', Object.getOwnPropertyDescriptor(Live.prototype, 'custom'));
    export class PeerObject extends CossackDurableObject {
      async getComponentRegistry() { return new Map([[componentPath, Live]]); }
      // The proxy forwards only the user id. Like the framework's middleware
      // replay, resolve the full user before authorizing each operation.
      async authorizeWebSocketPeer(client, peer, operation) {
        return super.authorizeWebSocketPeer(client, { ...peer, user: peer.user && { id: peer.user.id, tenant: 't1' } }, operation);
      }
      async fetch(request) {
        if(new URL(request.url).pathname==='/__test_schema-status')return Response.json(schemaCallbacks);
        // Force the production reconstruction path while keeping the actual
        // native socket attachments and durable storage. No eviction timing.
        if (new URL(request.url).pathname === '/__test_restore') {
          this.componentInstance = undefined; this.runtime = undefined;
          return Response.json({ restoredOnNextMessage: true });
        }
        return super.fetch(request);
      }
    }
    const app = new Hono();
    app.use('*', async (c, next) => {
      // Test-only auth/edge headers, supplied by this Worker. Browsers cannot
      // choose CF-Connecting-IP in production. No test auth endpoint is shipped.
      if (c.req.header('x-test-user')) {
        const user = { id: c.req.header('x-test-user'), tenant:'t1' };
        c.set('user', user);
        c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session',
          data: { reference: user.id, fingerprint: 'fixture-fingerprint' } }));
      }
      await next();
    });
    app.get('/id', c => c.json({ id: c.env.COSSACK_OBJECT.idFromName('object:' + (c.req.query('name') || 'shared')).toString() }));
    app.post('/restore', c => c.env.COSSACK_OBJECT.getByName('object:shared').fetch('https://object/__test_restore'));
    app.get('/schema-status',c=>c.env.COSSACK_OBJECT.getByName('object:shared').fetch('https://object/__test_schema-status'));
    app.get('/ws/:provider/:id/:channel', handleWebSocketProxy({
      pages: { [componentPath]: { default: Live } }, layouts: {}, allowedOrigins: ['http://localhost'],
      routePathToFilePathMap: new Map([['/live', componentPath]]),
    }));
    app.post('/http-limit', async c => {
      c.header('X-Cossack-Request-Id', crypto.randomUUID());
      const blocked = await enforceMethodRateLimit(c, Live, 'limited', JSON.stringify(['crpc', componentPath, Live.name]));
      return blocked || c.json({ allowed: true });
    });
    export default { fetch(request, env, context) {
      const headers = new Headers(request.headers);
      headers.set('cf-connecting-ip', headers.get('x-test-ip') || '192.0.2.1');
      return app.fetch(new Request(request, { headers }), env, context);
    } };
  `);
  const common = { main, compatibility_date: '2026-06-06', compatibility_flags: ['nodejs_compat'],
    vars: { MARK: 'peer-worker', rateLimit: 'durable-object' } };
  const options = { root: directory, workers: [
    { config: { ...common, name: 'first', durable_objects: { bindings: [
      { name: 'COSSACK_OBJECT', class_name: 'PeerObject' },
      { name: 'RATE_LIMIT_DO', class_name: 'RateLimitDurableObject' },
    ] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['PeerObject', 'RateLimitDurableObject'] }] } },
    { config: { ...common, name: 'second', durable_objects: { bindings: [
      { name: 'COSSACK_OBJECT', class_name: 'PeerObject', script_name: 'first' },
      { name: 'RATE_LIMIT_DO', class_name: 'RateLimitDurableObject', script_name: 'first' },
    ] } } },
  ] };
  server = createTestHarness(options);
  const { url } = await server.listen();
  const connect = async ({ worker = 'first', name = 'shared', ip = '192.0.2.1', user, bucket = 'one', extra = {} } = {}) => {
    const entry = server.getWorker(worker);
    const { id } = await (await entry.fetch(new URL('/id?name=' + name, url))).json();
    const route = new URL('/ws/page/' + id + '/global', url);
    route.searchParams.set('routePath', '/live'); route.searchParams.set('pathname', '/live');
    route.searchParams.set('params', JSON.stringify({ tenant: 'example' })); route.searchParams.set('filter', 'active');
    route.searchParams.set('object', name);
    const response = await entry.fetch(route, { headers: { Upgrade: 'websocket', Origin: 'http://localhost',
      'x-test-ip': ip, ...(user ? { 'x-test-user': user } : {}), 'x-bucket': bucket,
      Cookie: 'session=PRIVATE', Authorization: 'Bearer PRIVATE',
      'X-User-ID': 'forged-admin', 'X-User-Data': '{"id":"forged-admin"}', ...extra,
    } });
    if (response.status !== 101) return response;
    const socket = response.webSocket; socket.accept(); sockets.push(socket);
    const inbox = [];
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const frame = JSON.parse(data); inbox.push(frame);
      if (frame.type === 'done' || frame.type === 'error') {
        const complete = pending.get(frame.requestId); pending.delete(frame.requestId); complete?.(frame);
      }
    });
    return { socket, inbox, call(action, extraPayload = {}) {
      const requestId = crypto.randomUUID();
      const completion = new Promise(resolve => pending.set(requestId, resolve));
      socket.send(JSON.stringify({ v: 1, type: 'action', requestId, action, payload: [],
        user: { id: 'forged-admin' }, headers: { 'cf-connecting-ip': 'forged' }, ...extraPayload }));
      return Object.assign(completion,{requestId,cancel(){
        socket.send(JSON.stringify({v:1,type:'cancel',requestId}));pending.delete(requestId);
      }});
    } };
  };

  const a = await connect();
  expect(a.call).toBeTypeOf('function');
  expect((await a.call('inspect')).value).toMatchObject({ user: null, contextUser: null, ip: '192.0.2.1', bucket: 'one',
    tenant: 'example', filter: 'active', marker: 'peer-worker', cookie: null, authorization: null });
  expect((await a.call('limited')).type).toBe('done');
  await server.getWorker('first').evictDurableObject('RATE_LIMIT_DO', {
    name: JSON.stringify([JSON.stringify(['crpc', '/src/pages/live/index.ts', 'Live']) + ':limited', 'ip:192.0.2.1']),
  });
  const again = await connect({ worker: 'second', name: 'new-object' });
  expect(await again.call('limited')).toMatchObject({ type: 'error', code: 'COSSACK_RPC_RATE_LIMITED', requestId: expect.any(String) });
  expect((await again.call('inspect')).value.count).toBe(0);
  const otherIp = await connect({ ip: '192.0.2.2' });
  expect((await otherIp.call('limited')).type).toBe('done');
  const member = await connect({ user: 'member', ip: '192.0.2.1' });
  expect((await member.call('limited')).type).toBe('done');
  expect((await member.call('inspect')).value).toMatchObject({ user: 'member', contextUser: 'member' });
  const memberAgain = await connect({ worker: 'second', user: 'member', ip: '192.0.2.99' });
  expect(await memberAgain.call('limited')).toMatchObject({ type: 'error', code: 'COSSACK_RPC_RATE_LIMITED' });

  // Custom keys see the socket's own header and original page route params.
  expect((await a.call('custom')).type).toBe('done');
  expect(await again.call('custom')).toMatchObject({ type: 'error', code: 'COSSACK_RPC_RATE_LIMITED' });
  const secondBucket = await connect({ bucket: 'two', user: 'second' });
  expect((await secondBucket.call('custom')).type).toBe('done');
  const observations = await Promise.all([member.call('observe'), secondBucket.call('observe')]);
  expect(observations[0].value).toMatchObject({ user: 'member', bucket: 'one' });
  expect(observations[1].value).toMatchObject({ user: 'second', bucket: 'two' });
  expect(member.inbox.filter(frame => frame.type === 'yield').at(-1).value.user).toBe('member');

  // The actual HTTP limiter and native socket use one configured DO counter.
  const httpFirst = await server.getWorker('second').fetch(new URL('/http-limit', url), { method: 'POST', headers: { 'x-test-user': 'http-member' } });
  expect(httpFirst.status).toBe(200);
  const httpPeer = await connect({ user: 'http-member' });
  expect(await httpPeer.call('limited')).toMatchObject({ type: 'error', code: 'COSSACK_RPC_RATE_LIMITED' });
  const httpBlocked = await server.fetch('/http-limit', { method: 'POST', headers: { 'x-test-ip': '192.0.2.1' } });
  expect(httpBlocked.status).toBe(429);
  expect(await httpBlocked.json()).toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED', requestId: expect.any(String) });

  const oversized = await connect({ extra: { 'x-large-context': 'x'.repeat(40_000) } });
  expect(oversized.status).toBe(413);
  expect(await oversized.json()).toMatchObject({ code: 'COSSACK_WS_CONTEXT_TOO_LARGE' });
  expect((await a.call('inspect')).type).toBe('done');
  expect((await server.fetch('/restore', { method: 'POST' })).status).toBe(200);
  expect((await member.call('inspect')).value).toMatchObject({ user: 'member', contextUser: 'member', ip: '192.0.2.1', bucket: 'one', tenant: 'example' });
  expect((await secondBucket.call('inspect')).value).toMatchObject({ user: 'second', contextUser: 'second', bucket: 'two' });
  const beforePolicy = (await member.call('inspect')).value.count;
  for (const [peer, id, code] of [[member,2,'COSSACK_AUTH_FORBIDDEN'],[member,3,'COSSACK_AUTH_FORBIDDEN'],[member,99,'COSSACK_AUTH_FORBIDDEN'],[a,1,'COSSACK_AUTH_UNAUTHENTICATED']]) {
    expect(await peer.call('edit',{payload:[{id}],state:{canEdit:true,user:{id:'member'},owner:'member'}}))
      .toMatchObject({type:'error',code,requestId:expect.any(String),message:code==='COSSACK_AUTH_FORBIDDEN'?'Forbidden':'Authentication required'});
    expect((await member.call('inspect')).value.count).toBe(beforePolicy);
  }
  expect(await member.call('edit',{payload:[{id:'1'}]})).toMatchObject({type:'done',value:1});
  expect((await member.call('inspect')).value.count).toBe(beforePolicy+1);
  const raw={count:'3',enabled:'false',when:'2026-10-03T00:00:00.000Z',kind:'record',status:'draft',nullable:null,nested:{tags:['small']}};
  const beforeSchema=(await member.call('inspect')).value.count;
  for(const [change,fieldErrors] of [
    [value=>value.count='NaN',{count:'Expected a safe integer.'}],
    [value=>value.enabled='maybe',{enabled:'Expected a boolean.'}],
    [value=>value.when='2026-02-30T00:00:00.000Z',{when:'Expected a valid date.'}],
    [value=>value.kind='owner',{kind:'Unexpected value.'}],
    [value=>value.status='admin',{status:'Unexpected value.'}],
    [value=>value.note=null,{note:'Expected a string.'}],
    [value=>delete value.nullable,{nullable:'Expected a string.'}],
    [value=>value.nested.tags=['invalid'],{nested:{tags:{0:'Unexpected value.'}}}],
    [value=>value.canEdit=true,{canEdit:'Unknown field.'}],
    [value=>value.count='13',{_:'Disallowed count.'}],
  ]){
    const value=structuredClone(raw);change(value);
    expect(await member.call('parsed',{payload:[value]})).toMatchObject({type:'error',code:'COSSACK_VALIDATION_FAILED',fieldErrors,requestId:expect.any(String)});
    expect((await member.call('inspect')).value.count).toBe(beforeSchema);
  }
  for(const count of ['14','15','17','18']){
    expect(await member.call('parsed',{payload:[{...raw,count}]})).toMatchObject({type:'error',code:'COSSACK_RPC_INTERNAL_ERROR',message:'Internal Server Error',requestId:expect.any(String)});
    expect((await member.call('inspect')).value.count).toBe(beforeSchema);
  }
  expect(await member.call('policyException',{payload:[raw]})).toMatchObject({type:'error',code:'COSSACK_RPC_INTERNAL_ERROR',message:'Internal Server Error',requestId:expect.any(String)});
  expect((await member.call('inspect')).value.count).toBe(beforeSchema);
  expect(await member.call('parsed',{payload:[raw]})).toMatchObject({type:'done',value:{...raw,count:3,enabled:false,whenIsDate:true}});
  expect((await member.call('inspect')).value.count).toBe(beforeSchema+1);
  const waiting=member.call('parsed',{payload:[{...raw,count:'16'}]});
  await vi.waitFor(async()=>expect(await(await server.fetch('/schema-status')).json()).toMatchObject({started:1,aborted:0}));
  // The production client settles its own cancelled call. Native explicit
  // cancel suppresses later result/error frames; it is not a server reply.
  waiting.cancel();
  await vi.waitFor(async()=>expect(await(await server.fetch('/schema-status')).json()).toMatchObject({started:1,aborted:1}));
  expect((await member.call('inspect')).value.count).toBe(beforeSchema+1);
  expect(member.inbox.filter(frame=>frame.requestId===waiting.requestId&&['done','error'].includes(frame.type))).toEqual([]);
  await server.getWorker('first').evictDurableObject('RateLimitDurableObject', {
    name: JSON.stringify([JSON.stringify(['crpc', '/src/pages/live/index.ts', 'Live']) + ':limited', 'user:member']),
  });
  expect(await member.call('limited')).toMatchObject({ type: 'error', code: 'COSSACK_RPC_RATE_LIMITED' });
  await server.update({ ...options, workers: options.workers.map(worker => ({ config: { ...worker.config,
    vars: { ...worker.config.vars, rateLimit: 'unknown' } } })) });
  const invalidConfig = await connect({ name: 'invalid-config' });
  expect(await invalidConfig.call('limited')).toMatchObject({ type: 'error', code: 'COSSACK_RPC_INTERNAL_ERROR',
    message: 'Internal Server Error', requestId: expect.any(String) });
  expect((await invalidConfig.call('inspect')).value.count).toBe(0);
}, 60_000);
