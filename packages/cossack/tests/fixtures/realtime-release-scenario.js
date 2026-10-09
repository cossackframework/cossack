import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const repository = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

function subscriber(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let text = '';
  return {
    async until(marker) {
      const deadline = Date.now() + 8000;
      while (text.indexOf(marker) < 0 || text.indexOf('\n\n', text.indexOf(marker)) < 0) {
        let timer;
        try {
          const next = await Promise.race([
            reader.read(),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Native SSE observation deadline exceeded')),
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
          assert.equal(next.done, false, 'Native SSE subscription ended before observation');
          text += decoder.decode(next.value, { stream: true });
          assert.ok(text.length < 1024 * 1024);
        } finally {
          clearTimeout(timer);
        }
      }
      return text;
    },
    frames() {
      return text
        .split('\n\n')
        .filter((block) => block.includes('event: state-update'))
        .map((block) =>
          JSON.parse(
            block
              .split('\n')
              .find((line) => line.startsWith('data: '))
              .slice(6),
          ),
        );
    },
    text: () => text,
    close: () => reader.cancel(),
  };
}

export async function verifyRealtimeReleaseScenario({ installedRoot }) {
  const consumer = await fs.realpath(installedRoot);
  const relative = path.relative(repository, consumer);
  assert(
    relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    'A real installed consumer outside the workspace is required',
  );
  const requireConsumer = createRequire(path.join(consumer, 'package.json'));
  const cli = await fs.realpath(requireConsumer.resolve('cossack/bin/cossack.js'));
  const requireCli = createRequire(cli);
  const artifacts = {};
  for (const name of [
    'cossack',
    '@cossackframework/scaffold',
    '@cossackframework/core',
    '@cossackframework/framework',
    '@cossackframework/renderer',
  ]) {
    const resolver = name === '@cossackframework/scaffold' ? requireCli : requireConsumer;
    let resolved;
    try {
      resolved = resolver.resolve(`${name}/package.json`);
    } catch (error) {
      if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      for (const search of resolver.resolve.paths(name)) {
        const candidate = path.join(search, name, 'package.json');
        try {
          await fs.access(candidate);
          resolved = candidate;
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
    assert(resolved, `Installed metadata for ${name} is required`);
    const packagePath = await fs.realpath(resolved);
    assert(
      packagePath.startsWith(consumer + path.sep) && packagePath.includes('@file+'),
      `${name} must resolve to a consumer file tarball`,
    );
    const metadata = await fs.readFile(packagePath);
    artifacts[name] = {
      packagePath,
      version: JSON.parse(metadata.toString()).version,
      packageSha256: createHash('sha256').update(metadata).digest('hex'),
    };
  }
  assert(cli.startsWith(path.dirname(artifacts.cossack.packagePath) + path.sep));
  const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-realtime-scenario-'));
  await fs.chmod(evidence, 0o700);
  const app = path.join(evidence, 'app');
  let runtime;
  let primaryFailure;
  const subscriptions = [];
  const save = (name, value) =>
    fs.writeFile(path.join(evidence, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const command = async (label, args, cwd) => {
    try {
      const result = await execute(process.execPath, args, {
        cwd,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          VITEST: '',
          COSSACK_DISABLE_UPDATE_CHECK: '1',
          WRANGLER_SEND_METRICS: 'false',
          CLOUDFLARE_ENV: '',
          CLOUDFLARE_API_TOKEN: '',
        },
      });
      await fs.writeFile(path.join(evidence, `${label}.log`), result.stdout + result.stderr, { mode: 0o600 });
    } catch (error) {
      await fs.writeFile(path.join(evidence, `${label}.log`), (error.stdout ?? '') + (error.stderr ?? ''), {
        mode: 0o600,
      });
      throw new Error(`${label} failed; private evidence: ${evidence}`);
    }
  };
  try {
    await save('installed.json', { consumer, cli, artifacts });
    await command(
      'create',
      [cli, 'create', 'app', '--adapter', 'cloudflare', '--preset', 'minimal', '--yes', '--json'],
      evidence,
    );
    // Cache directories stay private; dependency targets remain immutable tarballs.
    const modules = path.join(app, 'node_modules');
    await fs.mkdir(modules);
    for (const item of await fs.readdir(path.join(consumer, 'node_modules'), { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const source = path.join(consumer, 'node_modules', item.name);
      const target = path.join(modules, item.name);
      if (item.name.startsWith('@')) {
        await fs.mkdir(target);
        for (const name of await fs.readdir(source))
          await fs.symlink(await fs.realpath(path.join(source, name)), path.join(target, name), 'dir');
      } else await fs.symlink(await fs.realpath(source), target, 'dir');
    }
    const write = async (name, source) => {
      const file = path.join(app, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, source);
    };
    // Application-owned identities model permitted sessions; this is not a real login test.
    await write(
      'src/bootstrap/middlewares.ts',
      `
import type { MiddlewareHandler } from 'hono';
const users: Record<string, {id:string;team:string;allowed:boolean}> = {
  'session-alice': {id:'alice',team:'shared',allowed:true},
  'session-bob': {id:'bob',team:'shared',allowed:true},
  'session-carol': {id:'carol',team:'other',allowed:true},
  'session-denied': {id:'denied',team:'shared',allowed:false},
};
const middlewares: MiddlewareHandler[] = [async(c,next)=>{
  const restored=c.get('cossack.realtimeIdentity');
  let user;
  if(restored!==undefined) {
    if(restored?.provider==='scenario.sessions'&&restored?.version===1) user=Object.values(users).find(value=>value.id===restored.data?.id);
  } else {
    const session=c.req.header('cookie')?.match(/(?:^|;\\s*)scenario_session=([^;]+)/)?.[1];
    user=session?users[session]:undefined;
  }
  c.set('user',user);
  c.set('cossack.captureRealtimeIdentity',user?async()=>({version:1,provider:'scenario.sessions',data:{id:user.id}}):undefined);
  await next();
}];
export default middlewares;
`,
    );
    await write(
      'src/pages/live/index.ts',
      `
import { Cossack, Page, Server, State, input } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
const permitted=async(c:any,next:()=>Promise<void>)=>{if(!c.get('user')?.allowed)return c.json({code:'SCENARIO_SCOPE_DENIED'},403);await next();};
const mayEdit=(_input:unknown,{context}:any)=>context.get('user')?.allowed===true;
@Page({transport:'sse',scope:c=>'team:'+c.get('user')?.team,middlewares:[permitted]})
export default class Live extends Cossack<any> {
 @State() count=0;
 @State() edits:string[]=[];
 @Server({input:input.string(),authorize:mayEdit})
 async edit(value:string){this.count++;this.edits=[...this.edits,this.c.get('user').id+':'+value];return {count:this.count,user:this.c.get('user').id,worker:this.env.MARK};}
 @Server({input:input.string(),authorize:mayEdit})
 async *disconnect(value:string){this.count++;this.edits=[...this.edits,this.c.get('user').id+':'+value];yield {count:this.count,user:this.c.get('user').id,worker:this.env.MARK};await new Promise(resolve=>setTimeout(resolve,800));return this.count;}
 render(){return html\`<output>\${this.count}</output>\`;}
}
`,
    );
    const require = createRequire(path.join(app, 'package.json'));
    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    await command('typecheck', [tsc, '--noEmit'], app);
    await command('build', [vite, 'build'], app);
    const manifest = JSON.parse(await fs.readFile(path.join(app, 'dist/client/cossack-routes.json'), 'utf8'));
    const route = manifest.filePathToId['/src/pages/live/index.ts'];
    assert.ok(route);
    const corePath = path.join(app, 'node_modules/@cossackframework/core');
    const coreManifest = JSON.parse(await fs.readFile(path.join(corePath, 'package.json'), 'utf8'));
    const { readRpcStream } = await import(pathToFileURL(path.join(corePath, coreManifest.exports['.'].import)).href);
    await write('.dev.vars', 'APP_SECRET=scenario-local-only\n');
    const { createTestHarness } = require('wrangler');
    const compiled = JSON.parse(await fs.readFile(path.join(app, 'dist/ssr/wrangler.json'), 'utf8'));
    delete compiled.configPath;
    delete compiled.userConfigPath;
    delete compiled.topLevelName;
    const common = {
      ...compiled,
      compatibility_date: '2026-10-09',
      main: path.join(app, 'dist/ssr/index.js'),
      assets: { ...compiled.assets, directory: path.join(app, 'dist/client') },
    };
    runtime = createTestHarness({
      root: app,
      workers: [
        { config: { ...common, name: 'scenario-first', vars: { ...common.vars, MARK: 'first' } } },
        {
          config: {
            ...common,
            name: 'scenario-second',
            vars: { ...common.vars, MARK: 'second' },
            migrations: [],
            durable_objects: {
              bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject', script_name: 'scenario-first' }],
            },
          },
        },
      ],
    });
    const { url } = await runtime.listen();
    const origin = new URL(url).origin;
    const headers = (user) => ({
      cookie: `scenario_session=session-${user}`,
      origin,
      'Content-Type': 'application/json',
    });
    const request = (worker, pathname, user, init = {}) =>
      runtime
        .getWorker(`scenario-${worker}`)
        .fetch(new URL(pathname, url), { ...init, headers: { ...headers(user), ...init.headers } });
    const scope = (user) => (user === 'carol' ? 'team:other' : 'team:shared');
    const envelope = (user, action, value, selectedScope = scope(user)) => ({
      componentRouteId: route,
      scopeKey: selectedScope,
      state: { count: 999, edits: ['FORGED'] },
      action,
      payload: [value],
    });
    const rpc = async (worker, user, value, selectedScope) => {
      const response = await request(worker, '/crpc', user, {
        method: 'POST',
        body: JSON.stringify(envelope(user, 'edit', value, selectedScope)),
      });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    for (const [worker, user] of [
      ['first', 'alice'],
      ['second', 'bob'],
      ['second', 'carol'],
    ]) {
      assert.equal((await request(worker, '/live', user)).status, 200);
      const response = await request(worker, `/sse/${route}?scopeKey=${encodeURIComponent(scope(user))}`, user);
      const stream = subscriber(response);
      subscriptions.push(stream);
      await stream.until('event: connected');
    }
    const [alice, bob, other] = subscriptions;
    const sentinel = `PRIVATE_SHARED_${randomUUID()}`;
    const concurrent = await Promise.all([
      rpc('first', 'alice', `${sentinel}-alice`),
      rpc('second', 'bob', `${sentinel}-bob`),
    ]);
    assert.deepEqual(concurrent.map((value) => value._cossack_return.count).sort(), [1, 2]);
    assert.deepEqual(
      concurrent.map((value) => ({ user: value._cossack_return.user, worker: value._cossack_return.worker })),
      [
        { user: 'alice', worker: 'first' },
        { user: 'bob', worker: 'second' },
      ],
    );
    for (const stream of [alice, bob]) {
      await stream.until(`${sentinel}-alice`);
      await stream.until(`${sentinel}-bob`);
      assert.equal(stream.frames().at(-1).count, 2);
    }
    const denied = await request('second', '/crpc', 'denied', {
      method: 'POST',
      body: JSON.stringify(envelope('denied', 'edit', 'DENIED')),
    });
    assert.equal(denied.status, 403);
    const foreign = await request('second', `/sse/${route}?scopeKey=${encodeURIComponent('team:shared')}`, 'carol');
    assert.equal(foreign.status, 403);
    const wrongScope = await request('second', '/crpc', 'carol', {
      method: 'POST',
      body: JSON.stringify(envelope('carol', 'edit', 'DENIED_CROSS_SCOPE', 'team:shared')),
    });
    assert.equal(wrongScope.status, 403);
    // Disconnect an actual TCP caller after receiving a native production RPC yield.
    const controller = new AbortController();
    const response = await fetch(new URL('/crpc', url), {
      method: 'POST',
      headers: headers('alice'),
      body: JSON.stringify(envelope('alice', 'disconnect', `${sentinel}-disconnected`)),
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const iterator = readRpcStream(response, controller.signal);
    const first = await iterator.next();
    assert.equal(first.value.type, 'yield');
    assert.equal(first.value.value.user, 'alice');
    controller.abort();
    let outcome;
    try {
      await iterator.next();
      assert.fail('Disconnected RPC incorrectly reported success');
    } catch (error) {
      outcome = error.code;
    }
    assert.equal(outcome, 'COSSACK_RPC_CANCELLED');
    const recovered = await rpc('second', 'bob', `${sentinel}-final`);
    // Cancellation does not promise rollback of the already published first yield.
    assert.equal(recovered._cossack_return.count, 4);
    for (const stream of [alice, bob]) {
      await stream.until(`${sentinel}-final`);
      const state = stream.frames().at(-1);
      assert.equal(state.count, 4);
      assert.deepEqual(
        [...state.edits].sort(),
        [
          `alice:${sentinel}-alice`,
          `bob:${sentinel}-bob`,
          `alice:${sentinel}-disconnected`,
          `bob:${sentinel}-final`,
        ].sort(),
      );
    }
    const own = await rpc('second', 'carol', 'OTHER_SCOPE_BOUNDARY');
    assert.equal(own._cossack_return.count, 1);
    await other.until('OTHER_SCOPE_BOUNDARY');
    assert.doesNotMatch(other.text(), /PRIVATE_SHARED_|DENIED_CROSS_SCOPE|FORGED/);
    assert.deepEqual(other.frames().at(-1).edits, ['carol:OTHER_SCOPE_BOUNDARY']);
    await save('verified.json', {
      identities: ['alice', 'bob'],
      workers: ['first', 'second'],
      concurrentCounts: [1, 2],
      convergedCount: 4,
      disconnectedOutcome: outcome,
      privateScopeIsolated: true,
      otherScopePositiveControl: true,
      sameCase: true,
      transport: 'native public production SSE/RPC',
      syntheticSessions: true,
    });
    await save('observations.json', {
      concurrent,
      recovered,
      own,
      sharedStates: [alice.frames(), bob.frames()],
      otherStates: other.frames(),
    });
    return { evidence, completed: true };
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    let nativeHarnessClosed = false,
      privateAppRemoved = false,
      cleanupFailure;
    await Promise.allSettled(subscriptions.map((stream) => stream.close()));
    try {
      if (runtime) {
        await runtime.close();
        nativeHarnessClosed = true;
      }
    } catch (error) {
      cleanupFailure = error;
    }
    try {
      await fs.rm(app, { recursive: true, force: true });
      privateAppRemoved = true;
    } catch (error) {
      cleanupFailure ??= error;
    }
    await save('cleaned.json', {
      nativeHarnessStarted: Boolean(runtime),
      nativeHarnessClosed,
      privateAppRemoved,
      cleanupError: cleanupFailure?.message,
    });
    if (cleanupFailure && !primaryFailure) throw cleanupFailure;
  }
}
