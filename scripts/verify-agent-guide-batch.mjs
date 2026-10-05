import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));

/** Run changed package-owned examples from a retained installation, without repacking unchanged packages. */
export async function verifyAgentGuideBatch(projectDir, selection) {
  projectDir = await fs.realpath(projectDir);
  const installed = createRequire(path.join(projectDir, 'package.json'));
  const cliFolder = await fs.realpath(path.join(projectDir, 'node_modules/cossack'));
  assert.ok(cliFolder.startsWith(projectDir + path.sep));
  const scratch = await fs.mkdtemp(path.join(projectDir, '.guide-batch-'));
  const attempts = path.join(scratch, 'network-attempts');
  const guard = path.join(scratch, 'offline.cjs');
  await fs.writeFile(guard, `const fs = require('node:fs');
const deny = () => { fs.appendFileSync(${JSON.stringify(attempts)}, 'attempt\\n'); throw Error('OFFLINE_GUIDE_BATCH'); };
globalThis.fetch = deny;
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
for (const name of ['node:http','node:https']) { const mod=require(name); mod.request=deny; mod.get=deny; }
const dns=require('node:dns'); for (const key of Object.keys(dns)) if (key==='lookup'||key.startsWith('resolve')) dns[key]=deny;
for (const key of Object.keys(dns.promises)) if (key==='lookup'||key.startsWith('resolve')) dns.promises[key]=deny;
require('node:module').syncBuiltinESMExports();
`);
  const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', COSSACK_DISABLE_UPDATE_CHECK: '1' };
  const node = async args => execute(process.execPath, ['--require', guard, ...args], { cwd: projectDir, env, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  try {
    await assert.rejects(node(['--eval', 'fetch("https://example.invalid")']), /OFFLINE_GUIDE_BATCH/);
    await fs.unlink(attempts);
    const { stdout, stderr } = await node([path.join(cliFolder, 'bin/cossack.js'), 'docs', '--json']);
    assert.equal(stderr, '');
    const catalog = JSON.parse(stdout);
    assert.equal(catalog.ok, true);
    const files = [], selected = [];
    let totalGuides = 0, totalExamples = 0;
    for (const pkg of catalog.data.packages.filter(item => item.installed && item.name !== '@cossackframework/desktop' && item.name !== 'cossack' && item.name !== '@cossackframework/solar-icons')) {
      assert.equal(pkg.guidance.status, 'available', `${pkg.name} guidance ${JSON.stringify(pkg.guidance)}`);
      assert.equal(pkg.guidance.version, pkg.version);
      assert.equal(pkg.guidance.exampleExecution, 'not-performed');
      assert.equal(pkg.guidanceCoverage.status, 'available', `${pkg.name} missing authored usage families`);
      totalGuides += pkg.guidance.guides.length;
      for (const guide of pkg.guidance.guides) {
        assert.ok(guide.examples.length, `${pkg.name}:${guide.id} has no executable example`);
        totalExamples += guide.examples.length;
        for (const specifier of guide.imports) assert.ok(pkg.exports.some(entry => entry.import === specifier && entry.targets.some(target => target.status === 'present')), `Unpublished ${specifier}`);
        if (!selection[pkg.name]?.includes(guide.id)) continue;
        selected.push(`${pkg.name}:${guide.id}`);
        for (const example of guide.examples) {
          const file = path.join(scratch, pkg.name.replaceAll('/', '-') + '-' + guide.id + '-' + example.id + '.ts');
          await fs.writeFile(file, example.source);
          files.push({ file, pkg: pkg.name, guide: guide.id, example: example.id });
        }
      }
    }
    assert.equal(selected.length, Object.values(selection).reduce((count, ids) => count + ids.length, 0), 'Every selected guide must come from installed metadata');
    const config = path.join(scratch, 'tsconfig.json');
    await fs.writeFile(config, JSON.stringify({compilerOptions: {
      target: 'ES2022', module: 'NodeNext', strict: true, noEmitOnError: true,
      experimentalDecorators: true, emitDecoratorMetadata: true, skipLibCheck: true,
      types: ['node'], lib: ['ES2022','DOM','DOM.Iterable'], outDir: path.join(scratch, 'compiled'),
    }, files: files.map(item => item.file) }));
    const tsc = path.join(path.dirname(installed.resolve('typescript/package.json')), 'bin/tsc');
    await node([tsc, '-p', config]).catch(error => { throw new Error(String(error.stdout) + String(error.stderr), { cause: error }); });
    const repositoryRequire = createRequire(path.join(repository, 'packages/test-utils/package.json'));
    const dom = pathToFileURL(repositoryRequire.resolve('jsdom')).href;
    const runtime = path.join(scratch, 'run.mjs');
    const entries = files.map(item => ({...item, file: pathToFileURL(path.join(scratch, 'compiled', path.basename(item.file, '.ts') + '.js')).href}));
    const bundler = await import(pathToFileURL(createRequire(installed.resolve('tsx/package.json')).resolve('esbuild')).href);
    for (const item of entries.filter(item => item.pkg === '@cossackframework/ui')) {
      const outfile = fileURLToPath(item.file).replace(/\.js$/, '.mjs');
      await bundler.build({entryPoints:[fileURLToPath(item.file)],outfile,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});
      item.file = pathToFileURL(outfile).href;
    }
    await fs.writeFile(runtime, `import assert from 'node:assert/strict';
import { JSDOM } from ${JSON.stringify(dom)};
const item=JSON.parse(process.argv[2]);
let dom;
if(item.guide==='browser-component-fixtures') {
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://app.example.test'});
 for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLFormElement','Element','Node','NodeFilter','ShadowRoot','customElements','Text','Comment','DocumentFragment','MutationObserver','CustomEvent','MouseEvent','Event']) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
 globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
 globalThis.cancelAnimationFrame=clearTimeout;
}
 const example=await import(item.file);
 if(item.guide==='browser-component-fixtures') await example.assertGreetingInBrowser();
 if(item.guide==='production-server-fixtures') {
  const seen=[];
  await example.assertProtectedApp(async request=>{
   seen.push(request); const authenticated=request.headers.get('cookie')?.includes('session=valid-test-session');
   if(!authenticated) return new Response('',{status:403});
   if(new URL(request.url).pathname==='/account') return new Response('<script>window.__INITIAL_STATE__ = {"public":{"allowed":true}};</script>');
   return Response.json({result:'pong'});
  },{}, {componentRouteId:'account',action:'ping',payload:[]});
  assert.equal(seen.length,3); assert.equal(seen[2].method,'POST');
 }
 console.log(item.pkg+':'+item.guide+':'+item.example);
dom?.window.close();
`);
    const outputs = [];
    for (const item of entries) {
      const result = await node([runtime, JSON.stringify(item)]).catch(error => { throw new Error(item.guide + '\n' + String(error.stdout) + String(error.stderr), { cause: error }); });
      assert.equal(result.stderr, ''); outputs.push(result.stdout.trim()); console.log(result.stdout.trim());
    }
    // MCP reads the same installed metadata; this does not execute examples.
    const mcpRequire = createRequire(path.join(repository, 'packages/cossack/package.json'));
    const { Client } = await import(mcpRequire.resolve('@modelcontextprotocol/client'));
    const { StdioClientTransport } = await import(mcpRequire.resolve('@modelcontextprotocol/client/stdio'));
    const client = new Client({name:'guide-batch',version:'1'});
    try {
      await client.connect(new StdioClientTransport({command:process.execPath,args:['--require',guard,path.join(cliFolder,'bin/cossack-mcp.js'),'--project',projectDir],env,cwd:projectDir,stderr:'pipe'}));
      const remote = await client.callTool({name:'read_documentation',arguments:{}});
      assert.equal(remote.isError, false);
      assert.deepEqual(remote.structuredContent.data, catalog.data);
    } finally { await client.close(); }
    await assert.rejects(fs.readFile(attempts), {code:'ENOENT'});
    console.log(JSON.stringify({totalGuides,totalExamples,changedGuides:selected.length,compiledAndExecuted:files.length,offlineCliMcp:'passed',nativeWorkflow:'not-run',serverFixture:'helper-contract-only',browserFixture:'jsdom'}));
    return {totalGuides,totalExamples,changedGuides:selected.length,compiledAndExecuted:files.length};
  } finally { await fs.rm(scratch, {recursive:true,force:true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [projectDir, selectionPath] = process.argv.slice(2);
  assert.ok(projectDir && selectionPath, 'Usage: node scripts/verify-agent-guide-batch.mjs <retained-installation> <selection.json>');
  await verifyAgentGuideBatch(projectDir, JSON.parse(await fs.readFile(selectionPath, 'utf8')));
}
