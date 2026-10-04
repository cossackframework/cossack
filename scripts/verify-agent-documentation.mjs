import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const exec = promisify(execFile);
// Only the test client comes from the repository. The server and CLI run from the installation.
const require = createRequire(new URL('../packages/cossack/package.json', import.meta.url));
const { Client } = await import(require.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(require.resolve('@modelcontextprotocol/client/stdio'));

export async function verifyAgentDocumentation(projectDir) {
  const cliFolder = await fs.realpath(path.join(projectDir, 'node_modules/cossack'));
  assert.ok(cliFolder.startsWith(projectDir + path.sep), 'CLI must come from the tarball installation');
  const cli = path.join(cliFolder, 'bin/cossack.js');
  const mcp = path.join(cliFolder, 'bin/cossack-mcp.js');
  const scratch = path.join(projectDir, '.agent-docs-acceptance');
  await fs.mkdir(scratch);
  const guard = path.join(scratch, 'offline.cjs');
  const attempts = path.join(scratch, 'network-attempts');
  // Applies to this Node process and MCP workers. Record attempts even if code swallows errors.
  // This exercises Node network APIs, not OS isolation against hostile native addons.
  await fs.writeFile(guard, `const fs = require('node:fs');
const deny = () => { fs.appendFileSync(${JSON.stringify(attempts)}, 'network attempt\\n'); throw new Error('OFFLINE_ACCEPTANCE'); };
globalThis.fetch = deny;
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
for (const name of ['node:http', 'node:https']) { const mod = require(name); mod.request = deny; mod.get = deny; }
const dns = require('node:dns');
for (const key of Object.keys(dns)) if (key === 'lookup' || key.startsWith('resolve')) dns[key] = deny;
for (const key of Object.keys(dns.promises)) if (key === 'lookup' || key.startsWith('resolve')) dns.promises[key] = deny;
require('node:module').syncBuiltinESMExports();
`);
  const nodeArgs = ['--require', guard];
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', COSSACK_DISABLE_UPDATE_CHECK: '1' };
  const invoke = async args => {
    const { stdout, stderr } = await exec(process.execPath, [...nodeArgs, cli, ...args], {
      cwd: projectDir, env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  };
  const client = new Client({ name: 'installed-docs-acceptance', version: '1' });
  try {
    // Prove the guard works before relying on a zero-attempt result.
    await assert.rejects(exec(process.execPath, [...nodeArgs, '--eval', 'fetch("https://example.invalid")'], { env }), /OFFLINE_ACCEPTANCE/);
    assert.match(await fs.readFile(attempts, 'utf8'), /network attempt/);
    await fs.unlink(attempts);

    const catalog = await invoke(['docs', '--json']);
    assert.equal(catalog.ok, true);
    const cliManifest = JSON.parse(await fs.readFile(path.join(cliFolder, 'package.json'), 'utf8'));
    assert.equal(catalog.data.cliVersion, cliManifest.version);
    assert.equal(catalog.data.guide.version, cliManifest.version);
    assert.equal(catalog.data.guide.markdown, await fs.readFile(path.join(cliFolder, 'src/agent-guide.md'), 'utf8'));
    assert.match(await fs.readFile(path.join(projectDir, 'AGENTS.md'), 'utf8'), /cossack docs --json/);
    assert.ok(catalog.data.commands.some(command => command.name === 'docs'));
    for (const pkg of catalog.data.packages.filter(pkg => pkg.installed)) {
      const folder = await fs.realpath(path.join(projectDir, 'node_modules', pkg.name));
      assert.ok(folder.startsWith(projectDir + path.sep), `${pkg.name} escaped the installation`);
      const manifest = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
      assert.equal(pkg.version, manifest.version);
    }

    // This harness executes only the repository-owned examples selected here.
    // The documentation tool itself only returns source text.
    const installedRequire = createRequire(path.join(projectDir, 'package.json'));
    const examples = [];
    for (const [name, id] of [['@cossackframework/core', 'route-urls'], ['@cossackframework/renderer', 'server-html'],
      ...['resource', 'mutation', 'scoped-service', 'protected-route'].map(feature => ['@cossackframework/scaffold', feature + '-recipe'])]) {
      const pkg = catalog.data.packages.find(pkg => pkg.name === name);
      assert.equal(pkg.guidance.status, 'available');
      assert.equal(pkg.guidance.version, pkg.version);
      assert.equal(pkg.guidance.exampleExecution, 'not-performed');
      const guide = pkg.guidance.guides.find(guide => guide.id === id);
      assert.ok(guide, `Missing packaged guide ${name}/${id}`);
      assert.ok(guide.examples.length, 'Guide must include an executable example');
      for (const example of guide.examples) {
        const file = path.join(scratch, `${id}-${example.id}.ts`);
        await fs.writeFile(file, example.source);
        examples.push(file);
      }
    }
    const config = path.join(scratch, 'tsconfig.json');
    await fs.writeFile(config, JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'NodeNext', strict: true, noEmitOnError: true,
      rootDir: scratch, outDir: path.join(scratch, 'compiled'),
      types: [], lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    }, files: examples }));
    const tsc = path.join(path.dirname(installedRequire.resolve('typescript/package.json')), 'bin/tsc');
    await exec(process.execPath, [...nodeArgs, tsc, '-p', config], { cwd: projectDir, env, timeout: 60_000 });
    for (const file of examples) {
      const result = await exec(process.execPath, [...nodeArgs, path.join(scratch, 'compiled', path.basename(file, '.ts') + '.js')], { cwd: projectDir, env, timeout: 30_000 });
      assert.equal(result.stderr, '');
    }
    console.log(`Compiled and executed ${examples.length} packaged usage examples against installed exports.`);

    const args = ['docs', '--package', '@cossackframework/renderer', '--symbols', '--json'];
    const documented = await invoke(args);
    assert.equal(documented.ok, true);
    const renderer = documented.data.packages[0];
    assert.ok(renderer.declarations.entries.some(entry => entry.symbols.some(symbol => symbol.name === 'html' && symbol.status === 'indexed')));
    const transport = new StdioClientTransport({ command: process.execPath, args: [...nodeArgs, mcp, '--project', projectDir], cwd: projectDir, env, stderr: 'pipe' });
    let stderr = '';
    transport.stderr?.on('data', chunk => { stderr += chunk; });
    await client.connect(transport);
    const remote = await client.callTool({ name: 'read_documentation', arguments: { package: renderer.name, symbols: true } });
    assert.equal(remote.isError, false);
    assert.deepEqual(remote.structuredContent.data, documented.data);

    // Real UI declarations must expose prop documentation and typed native attributes
    // through both transports, while retaining unresolved platform diagnostics.
    const ui = await invoke(['docs', '--package', '@cossackframework/ui', '--symbols', '--json']);
    assert.equal(ui.ok, true);
    const uiPackage = ui.data.packages[0];
    assert.equal(uiPackage.installed, true);
    const uiSymbols = uiPackage.declarations.entries.flatMap(entry => entry.symbols);
    const button = uiSymbols.find(symbol => symbol.name === 'Button');
    const dataTable = uiSymbols.find(symbol => symbol.name === 'DataTable');
    assert.equal(dataTable.propsContract.status, 'declared');
    assert.ok(dataTable.propsContract.members.some(member => member.name === 'onStateChange'));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'server-data-table'));

    assert.equal(button.propsContract.status, 'declared');
    assert.match(button.propsContract.members.find(member => member.name === 'variant').documentation, /Visual style/);
    assert.ok(!button.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(button.propsContract.members.some(member => member.name === '@click' && member.type.includes('HTMLButtonElement')));
    assert.ok(button.propsContract.members.some(member => member.name === 'disabled' && member.type.includes('boolean')));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'native-controls'));
    const radio = uiSymbols.find(symbol => symbol.name === 'RadioGroup');
    const slider = uiSymbols.find(symbol => symbol.name === 'Slider');
    assert.ok(radio.propsContract.members.some(member => member.name === 'onValueChange' && member.callSignatures.some(signature => signature.includes('HTMLInputElement'))));
    for (const control of [radio, slider]) assert.ok(!control.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'radio-and-range'));
    for (const [name, element] of [['Textarea','HTMLTextAreaElement'],['Select','HTMLSelectElement'],['NativeSelect','HTMLSelectElement'],['InputGroup','HTMLInputElement']]) {
      const control = uiSymbols.find(symbol => symbol.name === name);
      assert.equal(control.propsContract.status, 'declared');
      assert.ok(!control.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
      assert.ok(control.propsContract.members.some(member => member.name === '@change' && member.type.includes(element)));
      assert.ok(control.propsContract.members.some(member => member.name === '.value'));
      if (name !== 'InputGroup') assert.ok(!control.propsContract.members.some(member => member.name === 'value'));
      assert.ok(control.propsContract.members.some(member => member.name === 'aria-controls' && member.type.includes('string')));
    }
    const password = uiSymbols.find(symbol => symbol.name === 'PasswordInput');
    assert.ok(!password.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(password.propsContract.members.some(member => member.name === 'onChange' && member.callSignatures.some(signature => signature.includes('HTMLInputElement'))));
    assert.ok(!password.propsContract.members.some(member => ['type','.value','?disabled'].includes(member.name)));
    const otp = uiSymbols.find(symbol => symbol.name === 'InputOTP');
    assert.equal(otp.propsContract.status, 'declared');
    assert.ok(!otp.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(otp.propsContract.members.some(member => member.name === 'onComplete' && member.callSignatures.some(signature => signature.includes('HTMLInputElement'))));
    assert.ok(!otp.propsContract.members.some(member => ['type','.value','maxlength'].includes(member.name)));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'one-time-code'));
    const combobox = uiSymbols.find(symbol => symbol.name === 'Combobox');
    assert.equal(combobox.propsContract.status, 'declared');
    assert.ok(!combobox.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(combobox.propsContract.members.some(member => member.name === '@keydown' && member.type.includes('HTMLInputElement')));
    assert.ok(!combobox.propsContract.members.some(member => ['role','.value','aria-controls'].includes(member.name)));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'searchable-combobox'));
    const multiSelect = uiSymbols.find(symbol => symbol.name === 'MultiSelect');
    assert.equal(multiSelect.propsContract.status, 'declared');
    assert.ok(!multiSelect.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(multiSelect.propsContract.members.some(member => member.name === '@input' && member.type.includes('HTMLInputElement')));
    assert.ok(multiSelect.propsContract.members.some(member => member.name === 'validate' && member.callSignatures.some(signature => signature.includes('null'))));
    assert.ok(!multiSelect.propsContract.members.some(member => ['role','.value','aria-controls'].includes(member.name)));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'tag-multi-select'));
    for (const [name, target] of [['Calendar','HTMLDivElement'],['DatePicker','HTMLInputElement']]) {
      const control = uiSymbols.find(symbol => symbol.name === name);
      assert.equal(control.propsContract.status, 'declared');
      assert.ok(!control.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
      assert.ok(control.propsContract.members.some(member => member.name === '@keydown' && member.type.includes(target)));
      assert.ok(!control.propsContract.members.some(member => ['role','.value'].includes(member.name)));
    }
    assert.ok(uiSymbols.some(symbol => symbol.name === 'isCalendarDate'));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'gregorian-date-controls'));
    for (const name of ['Modal','Sheet','Drawer']) {
      const control = uiSymbols.find(symbol => symbol.name === name);
      assert.equal(control.propsContract.status, 'declared');
      assert.ok(!control.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
      assert.ok(control.propsContract.members.some(member => member.name === '@close' && member.type.includes('HTMLDialogElement')));
      assert.ok(!control.propsContract.members.some(member => ['role','.open','aria-modal','tabindex'].includes(member.name)));
    }
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'native-modal-dialogs'));
    const popover = uiSymbols.find(symbol => symbol.name === 'Popover');
    assert.equal(popover.propsContract.status, 'declared');
    assert.ok(!popover.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(popover.propsContract.members.some(member => member.name === '@click' && member.type.includes('HTMLButtonElement')));
    assert.ok(popover.propsContract.members.some(member => member.name === 'contentProps' && member.type.includes('PopoverContentProps')));
    assert.ok(!popover.propsContract.members.some(member => ['role','popovertarget','aria-expanded','open'].includes(member.name)));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'native-popover'));
    for (const [name, target] of [['DropdownMenu','HTMLButtonElement'],['ContextMenu','HTMLDivElement']]) {
      const control = uiSymbols.find(symbol => symbol.name === name);
      assert.equal(control.propsContract.status, 'declared');
      assert.ok(!control.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
      assert.ok(control.propsContract.members.some(member => member.name === '@keydown' && member.type.includes(target)));
      assert.ok(control.propsContract.members.some(member => member.name === 'menuProps' && member.type.includes('MenuPanelProps')));
      assert.ok(!control.propsContract.members.some(member => ['popovertarget','aria-expanded','open'].includes(member.name)));
    }
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'action-menus'));
    for (const [name, target] of [['Tooltip','HTMLSpanElement'],['HoverCard','HTMLDivElement']]) {
      const control = uiSymbols.find(symbol => symbol.name === name);
      assert.equal(control.propsContract.status, 'declared');
      assert.ok(!control.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
      assert.ok(control.propsContract.members.some(member => member.name === '@click' && member.type.includes(target)));
      assert.ok(control.propsContract.members.some(member => member.name === 'id' && member.type === 'string'));
      assert.ok(control.propsContract.members.some(member => member.name === 'label' && member.type === 'string'));
    }
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'hover-content'));
    const alertDialog = uiSymbols.find(symbol => symbol.name === 'AlertDialog');
    assert.equal(alertDialog.propsContract.status, 'declared');
    assert.ok(!alertDialog.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(alertDialog.propsContract.members.some(member => member.name === '@cancel' && member.type.includes('HTMLDialogElement')));
    assert.ok(alertDialog.propsContract.members.some(member => member.name === 'onAction' && member.type.includes('HTMLButtonElement')));
    assert.ok(!alertDialog.propsContract.members.some(member => ['role','aria-labelledby','closeOnBackdrop'].includes(member.name)));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'alert-confirmation'));
    const commandPalette = uiSymbols.find(symbol => symbol.name === 'Command');
    assert.equal(commandPalette.propsContract.status, 'declared');
    assert.ok(!commandPalette.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(commandPalette.propsContract.members.some(member => member.name === '@cancel' && member.type.includes('HTMLDialogElement')));
    assert.ok(commandPalette.propsContract.members.some(member => member.name === 'onOpenChange' && member.type.includes('boolean')));
    assert.ok(commandPalette.propsContract.members.some(member => member.name === 'shortcut'));
    assert.ok(uiSymbols.some(symbol => symbol.name === 'CommandItem'));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'modal-command-search'));
    for (const name of ['Accordion', 'AccordionItem', 'Collapsible']) {
      const control = uiSymbols.find(symbol => symbol.name === name);
      assert.equal(control.propsContract.status, 'declared');
      assert.ok(!control.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
      assert.ok(control.propsContract.members.some(member => member.name === '@click' && member.type.includes('HTMLDivElement')));
      assert.ok(control.propsContract.members.some(member => member.name === 'triggerProps' && member.type.includes('DisclosureTriggerProps')));
      assert.ok(control.propsContract.members.some(member => member.name === 'panelProps' && member.type.includes('DisclosurePanelProps')));
    }
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'native-disclosures'));
    const tabs = uiSymbols.find(symbol => symbol.name === 'Tabs');
    assert.equal(tabs.propsContract.status, 'declared');
    assert.ok(!tabs.propsContract.indexSignatures.some(index => index.keyType === 'string' && index.valueType === 'any'));
    assert.ok(tabs.propsContract.members.some(member => member.name === '@click' && member.type.includes('HTMLDivElement')));
    assert.ok(tabs.propsContract.members.some(member => member.name === 'listProps' && member.type.includes('TabsListProps')));
    assert.ok(tabs.propsContract.members.some(member => member.name === 'onChange' && member.type.includes('string')));
    assert.ok(uiSymbols.some(symbol => symbol.name === 'TabsItem'));
    assert.ok(uiPackage.guidance.guides.some(guide => guide.id === 'typed-tabs'));
    const uiFiltered = await invoke(['docs', '--package', uiPackage.name, '--symbols', '--symbol', 'Tabs', '--json']);
    assert.equal(uiFiltered.ok, true);
    assert.deepEqual(uiFiltered.data.packages[0].declarations.entries.flatMap(entry => entry.symbols.map(symbol => symbol.name)), ['Tabs']);
    const uiRemote = await client.callTool({ name: 'read_documentation', arguments: { package: uiPackage.name, symbols: true, symbol: 'Tabs' } });
    assert.equal(uiRemote.isError, false, JSON.stringify(uiRemote));
    assert.deepEqual(uiRemote.structuredContent.data, uiFiltered.data);
    console.log('Installed UI prop descriptions and index contracts match across CLI/MCP.');

    // A running MCP server must refresh installed facts after a package change.
    const manifestPath = path.join(projectDir, 'node_modules', renderer.name, 'package.json');
    const original = await fs.readFile(manifestPath, 'utf8');
    // Replace rather than overwrite an inode that pnpm could share with its store.
    const replaceManifest = async text => {
      await fs.writeFile(manifestPath + '.acceptance', text);
      await fs.rename(manifestPath + '.acceptance', manifestPath);
    };
    try {
      const changed = JSON.parse(original);
      changed.version = '0.0.0-acceptance';
      changed.exports = { './removed-by-acceptance': null };
      await replaceManifest(JSON.stringify(changed));
      const refreshed = await invoke(['docs', '--package', renderer.name, '--json']);
      const remoteRefresh = await client.callTool({ name: 'read_documentation', arguments: { package: renderer.name } });
      assert.deepEqual(remoteRefresh.structuredContent.data, refreshed.data);
      assert.equal(refreshed.data.packages[0].version, changed.version);
      assert.equal(refreshed.data.packages[0].guidance.status, 'partial');
      assert.deepEqual(refreshed.data.packages[0].guidance.guides, []);
      assert.notEqual(refreshed.data.packages[0].manifestHash, renderer.manifestHash);
      assert.deepEqual(refreshed.data.packages[0].exports.map(entry => entry.import), [renderer.name + '/removed-by-acceptance']);
    } finally { await replaceManifest(original); }
    await client.close();
    assert.equal(stderr, '');
    await assert.rejects(fs.access(attempts), { code: 'ENOENT' });
    console.log('Installed CLI/MCP documentation acceptance passed with Node networking disabled.');
  } finally {
    await client.close();
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
