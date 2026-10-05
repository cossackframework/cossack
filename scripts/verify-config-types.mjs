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
  const previous = await fs.readFile(output, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  await fs.mkdir(scratch);
  let factoryOwned = false;
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
    const repeated = await invoke('--generate'); assert.equal(repeated.generation.changed, false);
    await fs.unlink(factory); factoryOwned = false; await invoke('--generate');
    assert.ok(!(await fs.readFile(output, 'utf8')).includes('acceptance.ts'));
    console.log('Installed configuration CLI generation, inference and removal acceptance passed.');
  } finally {
    if (factoryOwned) await fs.rm(factory, { force: true });
    await fs.rm(scratch, { recursive: true, force: true });
    if (previous === null) await fs.rm(output, { force: true }); else await fs.writeFile(output, previous);
  }
}
