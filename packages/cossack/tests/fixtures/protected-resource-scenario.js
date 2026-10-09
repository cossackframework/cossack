import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium, expect as browserExpect } from '@playwright/test';

const execute = promisify(execFile);

/** Installed public packages; provider and browser are local, identity is fixture-owned. */
export async function verifyProtectedResourceScenario(installedRoot) {
  const retained = await fs.realpath(installedRoot);
  const repository = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
  const relative = path.relative(repository, retained);
  assert.ok(
    relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'Installed consumer must be outside the repository',
  );
  const require = createRequire(path.join(retained, 'package.json'));
  const artifacts = {};
  const receipt = async (name, filename) => {
    const packagePath = await fs.realpath(filename);
    assert.ok(
      packagePath.startsWith(retained + path.sep) && packagePath.includes('@file+'),
      `Expected retained file-tarball ${name}`,
    );
    const bytes = await fs.readFile(packagePath);
    artifacts[name] = {
      packagePath,
      version: JSON.parse(bytes).version,
      packageSha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  for (const name of [
    'cossack',
    '@cossackframework/core',
    '@cossackframework/framework',
    '@cossackframework/renderer',
  ]) {
    await receipt(name, path.join(retained, 'node_modules', name, 'package.json'));
  }
  const cliRequire = createRequire(await fs.realpath(path.join(retained, 'node_modules/cossack/package.json')));
  await receipt('@cossackframework/scaffold', cliRequire.resolve('@cossackframework/scaffold/package.json'));
  const { createTestHarness } = require('wrangler');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-protected-resource-'));
  await fs.chmod(root, 0o700);
  await fs.writeFile(path.join(root, 'installed-artifacts.json'), JSON.stringify(artifacts, null, 2), { mode: 0o600 });
  let harness, browser;
  const app = path.join(root, 'app');
  const actor = randomUUID();
  const command = async (label, binary, args) => {
    try {
      const result = await execute(binary, args, {
        cwd: app,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          VITEST: '',
          CLOUDFLARE_API_TOKEN: '',
          CLOUDFLARE_ACCOUNT_ID: '',
        },
        timeout: 180000,
        maxBuffer: 8 * 1024 * 1024,
      });
      await fs.writeFile(path.join(root, `${label}.log`), result.stdout + result.stderr, { mode: 0o600 });
    } catch (error) {
      await fs.writeFile(path.join(root, `${label}.log`), (error.stdout ?? '') + (error.stderr ?? ''), { mode: 0o600 });
      throw new Error(`${label} failed; private evidence ${root}`);
    }
  };
  try {
    await execute(
      process.execPath,
      [
        path.join(retained, 'node_modules/cossack/bin/cossack.js'),
        'create',
        'app',
        '--adapter',
        'cloudflare',
        '--preset',
        'minimal',
        '--yes',
        '--json',
      ],
      { cwd: root, timeout: 30000 },
    );
    // Package links borrow immutable installed payloads; cache directories and
    // scoped parents are private so Vite cannot write into the retained tree.
    const modules = path.join(app, 'node_modules');
    await fs.mkdir(modules);
    for (const item of await fs.readdir(path.join(retained, 'node_modules'), { withFileTypes: true })) {
      if (item.name.startsWith('.') && item.name !== '.bin') continue;
      const source = path.join(retained, 'node_modules', item.name);
      const target = path.join(modules, item.name);
      if (item.name.startsWith('@') || item.name === '.bin') {
        await fs.mkdir(target);
        for (const name of await fs.readdir(source))
          await fs.symlink(await fs.realpath(path.join(source, name)), path.join(target, name));
      } else await fs.symlink(await fs.realpath(source), target, 'dir');
    }
    const generatedConfig = JSON.parse(await fs.readFile(path.join(app, 'wrangler.jsonc'), 'utf8'));
    assert.match(generatedConfig.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
    await fs.writeFile(
      path.join(app, 'wrangler.jsonc'),
      JSON.stringify(
        {
          name: 'protected-resource-local',
          main: './src/index.ts',
          compatibility_date: generatedConfig.compatibility_date,
          compatibility_flags: ['nodejs_als', 'enable_request_signal'],
          assets: { binding: 'ASSETS', run_worker_first: true },
          vars: { APP_URL: 'http://localhost', APP_LOCALE: 'en' },
          d1_databases: [
            {
              binding: 'SCENARIO_DB',
              database_name: 'protected-resource-local',
              database_id: '00000000-0000-0000-0000-000000000001',
            },
          ],
          durable_objects: { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject' }] },
          migrations: [{ tag: 'v1', new_sqlite_classes: ['SseDurableObject'] }],
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(app, 'src/bootstrap/middlewares.ts'),
      `
import {getCookie} from 'hono/cookie';
import type {MiddlewareHandler} from 'hono';
// Test identity is accepted only against a server-owned secret, never client state.
const protectedIdentity:MiddlewareHandler=async(c,next)=>{
  if(c.req.path==='/records'||c.req.path==='/crpc'){
    if(getCookie(c,'scenario_actor')!==(c.env as any).SCENARIO_ACTOR)return c.json({code:'COSSACK_AUTH_UNAUTHENTICATED'},401);
    c.set('user' as any,{id:'scenario-owner'});
  }
  await next();
};
export default [protectedIdentity];
`,
    );
    await fs.mkdir(path.join(app, 'src/pages/records'), { recursive: true });
    await fs.writeFile(
      path.join(app, 'src/pages/records/index.ts'),
      `
import {Cossack,Page,Client,ClientState,Server,RpcError,input,type InputOf,server$,defineUrlState,url,getRequestContext} from '@cossackframework/core';
import {html} from '@cossackframework/renderer';
interface Row{id:number;name:string;version:number}
const filters=defineUrlState({search:url.string()});
const editInput=input.object({id:input.number({integer:true,min:1}),name:input.string({minLength:3,maxLength:40,message:'Enter at least three characters.'})});
@Page({transport:'http'}) export default class Records extends Cossack<any,{Resources:'rows'}>{
  @ClientState() search=''; @ClientState() draft=''; @ClientState() fieldError=''; @ClientState() saved='';
  get query(){return this.urlState(filters);}
  rows=server$(async(search:string):Promise<Row[]>=>{
    const c=getRequestContext()!;
    if(c.get('user')?.id!=='scenario-owner')throw new Error('Unauthorized query');
    await (c.env as any).SCENARIO_DB.prepare('INSERT INTO reads(search) VALUES (?)').bind(search).run();
    return (await (c.env as any).SCENARIO_DB.prepare('SELECT id,name,version FROM records WHERE name LIKE ? ORDER BY id').bind('%'+search+'%').all()).results as Row[];
  },{initial:[] as Row[],deps:()=>[this.query.search] as const});
  @Client() filter(){return this.updateUrlState(filters,{search:this.search});}
  @Server({input:editInput,authorize:(_value,{context})=>context.get('user')?.id==='scenario-owner'})
  async edit(value:InputOf<typeof editInput>):Promise<string>{
    const db=(getRequestContext()!.env as any).SCENARIO_DB;
    await db.batch([db.prepare('UPDATE records SET name=?,version=version+1 WHERE id=?').bind(value.name,value.id),db.prepare('INSERT INTO effects(record_id,name) VALUES (?,?)').bind(value.id,value.name)]);
    return 'Saved '+value.name;
  }
  @Client() async submit(event:Event){
    event.preventDefault();this.fieldError='';this.saved='';
    try{this.saved=await this.edit({id:1,name:this.draft});await this.refresh$('rows');}
    catch(error){if(error instanceof RpcError&&error.code==='COSSACK_VALIDATION_FAILED')this.fieldError=String(error.fieldErrors?.name??'Validation failed');else throw error;}
  }
  render(){return html\`<main><h1>Protected records</h1><label>Search<input id="filter" .value=\${this.search} @input=\${(e:Event)=>{this.search=(e.currentTarget as HTMLInputElement).value;}}></label><button id="apply-filter" @click=\${this.filter}>Filter</button>
    <ul id="records">\${this.rows.map(row=>html\`<li>\${row.name} (\${row.version})</li>\`)}</ul>
    <form @submit=\${this.submit}><label>Name<input id="draft" .value=\${this.draft} @input=\${(e:Event)=>{this.draft=(e.currentTarget as HTMLInputElement).value;}} aria-describedby="name-error"></label><p id="name-error">\${this.fieldError}</p><button type="submit">Save record</button></form><output id="saved">\${this.saved}</output></main>\`;}
}
`,
    );
    await command('types', 'pnpm', ['exec', 'tsc', '--noEmit']);
    await command('build', 'pnpm', ['exec', 'vite', 'build']);
    harness = createTestHarness({
      root: app,
      workers: [
        {
          configPath: path.join(app, 'dist/ssr/wrangler.json'),
          secrets: { APP_SECRET: randomUUID(), SCENARIO_ACTOR: actor },
        },
      ],
    });
    const origin = new URL((await harness.listen()).url).origin;
    const env = await harness.getWorker().getEnv();
    await env.SCENARIO_DB.exec(
      "CREATE TABLE records(id INTEGER PRIMARY KEY,name TEXT,version INTEGER); CREATE TABLE effects(record_id INTEGER,name TEXT); CREATE TABLE reads(search TEXT); INSERT INTO records VALUES(1,'Alice',0),(2,'Bob',0);",
    );
    const snapshot = async () => ({
      rows: (await env.SCENARIO_DB.prepare('SELECT * FROM records ORDER BY id').all()).results,
      effects: (await env.SCENARIO_DB.prepare('SELECT * FROM effects ORDER BY rowid').all()).results,
    });
    assert.equal((await fetch(origin + '/records')).status, 401);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies([{ name: 'scenario_actor', value: actor, url: origin }]);
    const page = await context.newPage();
    const errors = [],
      edits = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname !== '/crpc') return;
      const payload = request.postDataJSON();
      if (payload.action === 'edit') edits.push(payload);
    });
    const response = await page.goto(origin + '/records');
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => window.__cossackReady === true);
    await browserExpect(page.locator('#records')).toContainText('Alice');
    await browserExpect(page.locator('#records')).toContainText('Bob');
    await page.locator('#filter').fill('Alice');
    await page.locator('#apply-filter').click();
    await browserExpect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Alice');
    await browserExpect(page.locator('#records')).toContainText('Alice');
    await browserExpect(page.locator('#records')).not.toContainText('Bob');
    assert.ok(
      (await env.SCENARIO_DB.prepare("SELECT COUNT(*) AS n FROM reads WHERE search='Alice'").first()).n > 0,
      'URL filter must execute the same typed server resource against D1',
    );
    const before = await snapshot();
    await page.locator('#draft').fill('x');
    await page.getByRole('button', { name: 'Save record' }).click();
    await browserExpect(page.locator('#name-error')).toHaveText('Enter at least three characters.');
    await browserExpect(page.locator('#draft')).toHaveValue('x');
    assert.deepEqual(await snapshot(), before);
    await page.locator('#draft').fill('Alice updated');
    await page.getByRole('button', { name: 'Save record' }).click();
    await browserExpect(page.locator('#saved')).toHaveText('Saved Alice updated');
    await browserExpect(page.locator('#records')).toContainText('Alice updated (1)');
    assert.equal(edits.length, 2);
    const accepted = await snapshot();
    assert.deepEqual(accepted.effects, [{ record_id: 1, name: 'Alice updated' }]);
    const forged = structuredClone(edits.at(-1));
    forged.payload = [{ id: 1, name: 'Unauthorized edit' }];
    forged.state = { ...(forged.state ?? {}), user: { id: 'scenario-owner' }, permissions: { edit: true } };
    const denied = await fetch(origin + '/crpc', {
      method: 'POST',
      headers: { origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(forged),
    });
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).code, 'COSSACK_AUTH_UNAUTHENTICATED');
    const afterDenied = await snapshot();
    assert.deepEqual(afterDenied, accepted);
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(root, 'scenario-observations.json'),
      JSON.stringify(
        {
          filteredSearch: new URL(page.url()).searchParams.get('search'),
          reads: (await env.SCENARIO_DB.prepare('SELECT search FROM reads ORDER BY rowid').all()).results,
          beforeEdits: before,
          acceptedEdit: accepted,
          afterUnauthorized: afterDenied,
          unauthorizedStatus: denied.status,
          editRequests: edits.length,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const verified = {
      installed: true,
      protectedTypedQuery: true,
      urlFilters: true,
      serverFieldErrorPreservesInput: true,
      successfulDurableEdit: true,
      directUnauthorizedSameEditRejected: true,
      root,
      scope: 'local native workerd/Chromium; server-owned synthetic cookie identity',
    };
    await fs.writeFile(path.join(root, 'verified.json'), JSON.stringify(verified, null, 2), { mode: 0o600 });
    await context.close();
    return verified;
  } finally {
    const results = await Promise.allSettled([browser?.close(), harness?.close()]);
    // Detach borrowed dependencies even if either native owner failed to close.
    await fs.rm(path.join(app, 'node_modules'), { recursive: true, force: true });
    await fs.writeFile(
      path.join(root, 'cleanup.json'),
      JSON.stringify({
        browserClosed: results[0].status === 'fulfilled',
        harnessClosed: results[1].status === 'fulfilled',
        borrowedDependenciesDetached: true,
      }),
      { mode: 0o600 },
    );
    assert.ok(
      results.every((result) => result.status === 'fulfilled'),
      `Native owner cleanup failed; private evidence ${root}`,
    );
  }
}
