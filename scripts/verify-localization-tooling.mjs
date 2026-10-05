import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);

/** Exercise installed CLI generation and published imported/global translation types. */
export async function verifyLocalizationTooling(projectDir) {
  projectDir = await fs.realpath(projectDir);
  const require = createRequire(path.join(projectDir, 'package.json'));
  const cliDirectory = await fs.realpath(path.dirname(path.dirname(require.resolve('cossack/bin/cossack.js'))));
  assert.ok(cliDirectory.startsWith(projectDir + path.sep), 'Use the installed tarball CLI.');
  const core = await fs.realpath(path.join(projectDir, 'node_modules/@cossackframework/core'));
  const framework = await fs.realpath(path.join(projectDir, 'node_modules/@cossackframework/framework'));
  for (const directory of [core, framework]) assert.ok(directory.startsWith(projectDir + path.sep), 'Use published application dependencies, not workspace links.');
  await fs.access(path.join(core, 'dist/index.d.ts'));
  await fs.access(require.resolve('@cossackframework/framework/vite-env'));
  const cli = path.join(cliDirectory, 'bin/cossack.js');
  const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  // A private nested project avoids changing the installed application's catalogs.
  // Its imports resolve the installed parent's node_modules without source aliases.
  const fixture = await fs.mkdtemp(path.join(projectDir, '.localization-acceptance-'));
  const options = { cwd: fixture, timeout: 30000, maxBuffer: 2 * 1024 * 1024 };
  const write = async (file, value) => {
    const target = path.join(fixture, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const invoke = async (sub, flags = [], expected = 0) => {
    let result;
    try { result = await exec(process.execPath, [cli, 'lang', sub, '--locale=en', '--json', ...flags], options); }
    catch (error) { assert.equal(error.code, expected, 'Unexpected installed localization exit status.'); result = error; }
    if (expected !== 0) assert.equal(result.code, expected);
    assert.equal(result.stderr, '');
    assert.ok(!result.stdout.includes('PRIVATE_TRANSLATION_SENTINEL'));
    assert.ok(!result.stdout.includes('APPLICATION_MUST_NOT_EXECUTE'));
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.command, 'lang');
    assert.equal(envelope.ok, expected === 0);
    return envelope;
  };
  try {
    await write('package.json', { name: 'localization-acceptance', type: 'module', private: true });
    await write('src/lang/en.json', { welcome: 'PRIVATE_TRANSLATION_SENTINEL :name', apples: ':count apple for :name|:count apples for :name', unused: 'Unused', 'Intentional sentence.': 'Intentional sentence.' });
    await write('src/lang/es.json', { welcome: 'Hola :person', apples: ':count :person|:count apples' });
    await write('src/page.ts', "throw new Error('APPLICATION_MUST_NOT_EXECUTE');\n__('welcome', { name: 'Sam' }); __('apples', { count: 2, name: 'Sam' }); __('missing'); __(dynamicKey);\n");
    const extracted = await invoke('extract');
    assert.equal(extracted.data.defaultLocale, 'en');
    assert.equal(extracted.data.fallbackLocale, 'en');
    assert.equal(extracted.data.unresolved.length, 1);
    assert.ok(extracted.data.calls.some(call => call.key === 'welcome' && call.file === 'src/page.ts' && call.line === 2 && call.column > 0));
    const rejected = await invoke('check', [], 1);
    const codes = rejected.diagnostics.map(item => item.code);
    for (const code of ['KEY_MISSING', 'KEY_UNKNOWN', 'PLACEHOLDERS_MISMATCH', 'PLURAL_PARAMETERS', 'DYNAMIC_KEY', 'KEY_UNUSED']) assert.ok(codes.includes(`COSSACK_LANG_${code}`), `Missing ${code} acceptance.`);
    assert.ok(rejected.diagnostics.some(item => item.code === 'COSSACK_LANG_KEY_MISSING' && item.locale === 'es' && item.fallback === 'en'));
    await invoke('types', [], 1);
    await assert.rejects(fs.access(path.join(fixture, '.cossack/translations.d.ts')));

    await write('src/lang/es.json', { welcome: 'Hola :Name', apples: ':count :name a|:count :name b|:count :name c', unused: 'Sin uso', 'Intentional sentence.': 'Frase.' });
    await write('src/page.ts', "__('welcome', { name: 'Sam' }); __('apples', { count: 2, name: 'Sam' }); __('Intentional sentence.'); __(dynamicKey);\n");
    assert.equal((await invoke('check')).data.valid, true);
    const dryRun = await invoke('types', ['--dry-run']);
    assert.equal(dryRun.data.generated, false);
    assert.equal(dryRun.data.dryRun, true);
    await assert.rejects(fs.access(path.join(fixture, '.cossack/translations.d.ts')));
    assert.equal((await invoke('types')).data.generated, true);
    const generated = await fs.readFile(path.join(fixture, '.cossack/translations.d.ts'), 'utf8');
    assert.ok(generated.includes('CossackTranslationRegistry'));
    assert.ok(generated.includes('"count": number'));
    assert.ok(!generated.includes('PRIVATE_TRANSLATION_SENTINEL'));
    await write('consumer.ts', `import { __ as translate } from '@cossackframework/core';
translate('welcome', { name: 'Sam' }); __('welcome', { name: 'Sam' });
translate('apples', { count: 1, name: 'Sam' }); __('Intentional sentence.');
// @ts-expect-error Imported helper must reject unknown keys.
translate('unknown');
// @ts-expect-error Framework global must reject unknown keys.
__('unknown');
// @ts-expect-error Imported helper must require name.
translate('welcome');
// @ts-expect-error Framework global must require name.
__('welcome');
// @ts-expect-error A renamed parameter is not name.
translate('welcome', { person: 'Sam' });
// @ts-expect-error Plural count must be a number.
__('apples', { count: '1', name: 'Sam' });
`);
    await write('tsconfig.json', { compilerOptions: { noEmit: true, strict: true, skipLibCheck: true, module: 'ESNext', moduleResolution: 'Bundler', target: 'ESNext', lib: ['ESNext', 'DOM'], types: ['node', '@cossackframework/framework/vite-env'], experimentalDecorators: true, emitDecoratorMetadata: true }, files: ['consumer.ts', '.cossack/translations.d.ts'] });
    try { await exec(process.execPath, [compiler, '-p', path.join(fixture, 'tsconfig.json')], options); }
    catch (error) { throw new Error(`Installed translation types failed:\n${error.stdout ?? ''}\n${error.stderr ?? ''}`); }
    console.log('Installed localization extraction/checks, safe JSON, dry-run generation and imported/global catalog types passed.');
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'Usage: node scripts/verify-localization-tooling.mjs <installed-project-root>');
  await verifyLocalizationTooling(process.argv[2]);
}
