import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const exec = promisify(execFile);

/** Verify the installed CLI, generated augmentation and published config types together. */
export async function verifyConfigTypes(projectDir) {
  const cliDirectory = await fs.realpath(path.join(projectDir, 'node_modules/cossack'));
  assert.ok(cliDirectory.startsWith(projectDir + path.sep), 'Use an installed tarball CLI');
  const cli = path.join(cliDirectory, 'bin/cossack.js');
  const require = createRequire(path.join(projectDir, 'package.json'));
  const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  const applicationConfig = JSON.parse(await fs.readFile(path.join(projectDir, 'tsconfig.json'), 'utf8'));
  const scratch = path.join(projectDir, '.config-types-acceptance');
  const factory = path.join(projectDir, 'src/config/acceptance.ts');
  const output = path.join(projectDir, '.cossack/config.d.ts');
  const metadataFactory = path.join(projectDir, 'src/config/requirements-acceptance.ts');
  const previous = await fs.readFile(output, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  await fs.mkdir(scratch);
  let factoryOwned = false; let metadataOwned = false;
  try {
    await fs.writeFile(factory, `throw new Error('CONFIG_FACTORY_EXECUTED');
interface Shape { nested: { count: number }; privateValue: string }
export default (): Shape => ({ nested: { count: 1 }, privateValue: 'CONFIG_PRIVATE_SENTINEL' });
`, { flag: 'wx' });
    factoryOwned = true;
    const invoke = async (...args) => {
      const result = await exec(process.execPath, [cli, 'config', ...args, '--json'], { cwd: projectDir, timeout: 30000 });
      assert.equal(result.stderr, '');
      assert.ok(!result.stdout.includes('CONFIG_PRIVATE_SENTINEL'));
      const envelope = JSON.parse(result.stdout); assert.equal(envelope.ok, true); return envelope.data;
    };
    const catalog = await invoke();
    assert.equal(catalog.evaluation, 'not-performed'); assert.equal(catalog.validation, 'not-performed');
    assert.ok(catalog.factories.some(entry => entry.key === 'acceptance'));
    await invoke('--generate');
    const generated = await fs.readFile(output, 'utf8');
    assert.ok(generated.includes('acceptance.ts'));
    assert.ok(!generated.includes('CONFIG_PRIVATE_SENTINEL'));
    await fs.writeFile(path.join(scratch, 'consumer.ts'), `import { config } from '@cossackframework/framework/config';
const count: number = config('acceptance.nested.count');
// @ts-expect-error misspelled path
config('acceptance.nested.cout');
// @ts-expect-error wrong default type
config('acceptance.nested.count', 'one');
`);
    await fs.writeFile(path.join(scratch, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      noEmit: true, strict: true, skipLibCheck: applicationConfig.compilerOptions?.skipLibCheck ?? false, module: 'ESNext', moduleResolution: 'bundler',
      target: 'ESNext', allowImportingTsExtensions: true, types: ['node'],
    }, files: ['consumer.ts', '../.cossack/config.d.ts'] }));
    await exec(process.execPath, [compiler, '-p', path.join(scratch, 'tsconfig.json')], { cwd: projectDir, timeout: 30000 });
    await fs.writeFile(metadataFactory, `import { requireConfigVariable, type ConfigRequirements } from '@cossackframework/framework/config';
export const requirements = { variables: { TEST_OPTIONAL_PORT: { type: 'number', coerce: true, required: false }, TEST_SECRET: { type: 'string', secret: true } } } as const satisfies ConfigRequirements;
export default () => { throw new Error('REQUIREMENTS_FACTORY_EXECUTED'); return { port: requireConfigVariable('TEST_OPTIONAL_PORT', 'number') }; };
`, { flag: 'wx' }); metadataOwned = true;
    const declarations = await invoke('--check');
    assert.equal(declarations.validation, 'declarations-only');
    assert.equal(declarations.remoteSecrets, 'not-checked');
    assert.ok(declarations.unverifiedSecrets.includes('TEST_SECRET'));
    assert.ok(declarations.factories.some(entry => entry.key === 'requirements-acceptance' && entry.status === 'declared'));
    await invoke('--generate');
    await fs.appendFile(path.join(scratch, 'consumer.ts'), `
const declaredPort: number = config('requirements-acceptance.port');
// @ts-expect-error declared accessor inference is numeric
config('requirements-acceptance.port', '81');
`);
    await exec(process.execPath, [compiler, '-p', path.join(scratch, 'tsconfig.json')], { cwd: projectDir, timeout: 30000 });
    await fs.writeFile(metadataFactory, `export const requirements = { variables: { REQUIRED_ACCEPTANCE_PORT: { type: 'number' } } }; export default () => { throw new Error('REQUIREMENTS_FACTORY_EXECUTED'); };
`);
    const beforeFailure = await fs.readFile(output, 'utf8');
    try { await exec(process.execPath, [cli, 'config', '--check', '--generate', '--json'], { cwd: projectDir, timeout: 30000 }); assert.fail('Required declaration must fail'); }
    catch (error) {
      assert.equal(error.code, 1);
      const envelope = JSON.parse(error.stdout);
      assert.equal(envelope.ok, false);
      assert.ok(envelope.diagnostics.some(item => item.code === 'COSSACK_CONFIG_REQUIRED_MISSING' && item.name === 'REQUIRED_ACCEPTANCE_PORT'));
      assert.ok(!error.stdout.includes('REQUIREMENTS_FACTORY_EXECUTED'));
    }
    assert.equal(await fs.readFile(output, 'utf8'), beforeFailure);
    await fs.unlink(metadataFactory); metadataOwned = false; await invoke('--generate');
    const repeated = await invoke('--generate'); assert.equal(repeated.generation.changed, false);
    await fs.unlink(factory); factoryOwned = false; await invoke('--generate');
    assert.ok(!(await fs.readFile(output, 'utf8')).includes('acceptance.ts'));
    console.log('Installed configuration CLI generation, inference and removal acceptance passed.');
  } finally {
    if (factoryOwned) await fs.rm(factory, { force: true });
    if (metadataOwned) await fs.rm(metadataFactory, { force: true });
    await fs.rm(scratch, { recursive: true, force: true });
    if (previous === null) await fs.rm(output, { force: true }); else await fs.writeFile(output, previous);
  }
}
