// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const compiler = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc');
import { generateConfigTypes } from '../src/config-codegen';
import { cossackConfig } from '../src/vite-plugin';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function project() { const root = mkdtempSync(join(tmpdir(), 'cossack-config-')); roots.push(root); mkdirSync(join(root, 'src/config'), { recursive: true }); return root; }
it('discovers only flat factories without evaluating or copying their values', () => {
  const root = project();
  for (const name of ['z.ts', 'app.ts', 'a.test.ts', 'b.spec.ts', 'types.d.ts']) writeFileSync(join(root, 'src/config', name), 'throw new Error("SECRET_SENTINEL"); export default () => ({ value: 1 });');
  const result = generateConfigTypes(root, { write: false });
  expect(result.factories).toEqual(['app.ts', 'z.ts']);
  expect(result.source).not.toContain('SECRET_SENTINEL');
  expect(existsSync(join(root, '.cossack'))).toBe(false);
  generateConfigTypes(root);
  expect(generateConfigTypes(root).changed).toBe(false);
  unlinkSync(join(root, 'src/config/app.ts'));
  expect(generateConfigTypes(root).source).not.toContain('app.ts');
});
it('preserves authored destinations and rejects symbolic links', () => {
  const root = project(); mkdirSync(join(root, '.cossack'));
  const file = join(root, '.cossack/config.d.ts'); writeFileSync(file, 'authored');
  expect(() => generateConfigTypes(root)).toThrow('authored');
  expect(readFileSync(file, 'utf8')).toBe('authored'); unlinkSync(file);
  symlinkSync(join(root, 'src'), file);
  expect(() => generateConfigTypes(root)).toThrow('symbolic link');
});
it('infers nested paths and preserves explicit registry overrides', () => {
  const root = project();
  writeFileSync(join(root, 'src/config/custom.ts'), 'interface Shape { nested: { count: number }; flag: boolean } export default (): Shape => ({ nested: { count: 1 }, flag: true });');
  generateConfigTypes(root);
  const consumer = join(root, 'consumer.ts');
  writeFileSync(consumer, `import { config } from '@cossackframework/framework/config';
const count: number = config('custom.nested.count');
// @ts-expect-error unknown path
config('custom.missing');
// @ts-expect-error incorrect default
config('custom.flag', 'yes');
declare module '@cossackframework/framework/config' { interface CossackConfigRegistry { override: { value: string } } }
const explicit: string = config('override.value');
`);
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    strict: true, noEmit: true, skipLibCheck: false, types: ['node'],
    typeRoots: [join(dirname(createRequire(import.meta.url).resolve('@types/node/package.json')), '..')], target: 'ESNext',
    module: 'ESNext', moduleResolution: 'bundler', allowImportingTsExtensions: true,
    paths: { '@cossackframework/framework/config': [join(process.cwd(), 'src/config.ts')] },
  }, files: ['consumer.ts', '.cossack/config.d.ts'] }));
  const check = () => { try { execFileSync(process.execPath, [compiler, '-p', join(root, 'tsconfig.json')], { timeout: 30000, stdio: 'pipe' }); } catch (error: any) { throw new Error(String(error.stdout) + String(error.stderr)); } };
  check();
  writeFileSync(consumer, `import { config } from '@cossackframework/framework/config';
declare module '@cossackframework/framework/config' { interface CossackConfigRegistry { custom: { flag: 'explicit' } } }
const flag: 'explicit' = config('custom.flag');
// @ts-expect-error authored shape replaces the inferred shape
config('custom.nested.count');
`);
  check();
});
it('generates empty registries and refreshes development additions and removals', () => {
  const root = project(); const plugin = cossackConfig() as any;
  plugin.configResolved({ root });
  expect(generateConfigTypes(root).factories).toEqual([]);
  const watcher = new EventEmitter() as any; watcher.add = () => {};
  const httpServer = new EventEmitter(); plugin.configureServer({ watcher, httpServer, config: { logger: { error: (message: string) => { throw new Error(message); } } } });
  const file = join(root, 'src/config/new.ts'); writeFileSync(file, 'export default () => ({ ready: true });'); watcher.emit('add', file);
  expect(readFileSync(join(root, '.cossack/config.d.ts'), 'utf8')).toContain('new.ts');
  unlinkSync(file); watcher.emit('unlink', file);
  expect(readFileSync(join(root, '.cossack/config.d.ts'), 'utf8')).not.toContain('new.ts');
  httpServer.emit('close'); expect(watcher.listenerCount('add')).toBe(0);
  expect(plugin.load.call({ environment: { name: 'client' } }, '\0virtual:cossack-config')).toBe('const configs = {};\nexport const requirements = {};\nexport const environment = null;\nexport default configs;\n');
});
it('keeps factory source and values out of a built client bundle', async () => {
  const { build } = await import('vite');
  const root = project();
  writeFileSync(join(root, 'src/config/private.ts'), `throw new Error('COSSACK_FACTORY_EXECUTION_SENTINEL'); export const requirements = { variables: { COSSACK_METADATA_SENTINEL: { type: 'string', secret: true } } }; export default () => ({ token: 'COSSACK_PRIVATE_VALUE_SENTINEL' });`);
  writeFileSync(join(root, 'entry.ts'), `import configs, { requirements, environment } from 'virtual:cossack-config'; console.log(configs, requirements, environment);`);
  const built = await build({ root, configFile: false, logLevel: 'silent', plugins: [cossackConfig()],
    build: { write: false, lib: { entry: join(root, 'entry.ts'), formats: ['es'], fileName: 'client' } } });
  const bundles = Array.isArray(built) ? built : [built];
  const output = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : [])
    .map(chunk => chunk.type === 'chunk' ? chunk.code : String(chunk.source)).join('\n');
  expect(output).toContain('console.log');
  expect(output).not.toContain('COSSACK_FACTORY_EXECUTION_SENTINEL');
  expect(output).not.toContain('COSSACK_PRIVATE_VALUE_SENTINEL');
  expect(output).not.toContain('COSSACK_METADATA_SENTINEL');
  expect(output).not.toContain('src/config/private');
  expect(readFileSync(join(root, '.cossack/config.d.ts'), 'utf8')).toContain('private.ts');
});
it('collects actual SSR declarations and selected environment without running factories', async () => {
  const { build } = await import('vite');
  const { prepareConfigStore, runWithConfig, requireConfigVariable } = await import('../src/config');
  const root = project();
  writeFileSync(join(root, 'src/config/app.ts'), `
export const requirements = { variables: { PORT: { type: 'number', coerce: true } } };
export const calls: string[] = [];
export default ({ env }: { env: (name: string) => string }) => { calls.push('entered'); return { name: env('APP_NAME') }; };
`);
  const entry = join(root, 'entry.ts');
  writeFileSync(entry, `import factories, { requirements, environment } from 'virtual:cossack-config';
export { factories, requirements, environment }; export { calls } from './src/config/app.ts';`);
  const built = await build({ root, configFile: false, logLevel: 'silent', plugins: [cossackConfig({ environment: 'staging' })],
    build: { ssr: entry, write: false, minify: false } });
  const bundles = Array.isArray(built) ? built : [built];
  const chunk = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : []).find(output => output.type === 'chunk');
  expect(chunk?.type).toBe('chunk');
  const loaded = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from((chunk as any).code).toString('base64'));
  expect(loaded.environment).toBe('staging');
  expect(loaded.requirements).toEqual({ app: { variables: { PORT: { type: 'number', coerce: true } } } });
  expect(loaded.calls).toEqual([]);
  const options = { requirements: loaded.requirements, context: { runtime: 'node' as const, environment: loaded.environment } };
  expect(() => prepareConfigStore(loaded.factories, { PORT: 'PRIVATE_PORT_SENTINEL' }, options))
    .toThrow(expect.objectContaining({ code: 'COSSACK_CONFIG_VARIABLE_INVALID', requirementName: 'PORT', environment: 'staging' }));
  expect(loaded.calls).toEqual([]);
  const store = prepareConfigStore(loaded.factories, { PORT: '81', APP_NAME: 'SSR app' }, options);
  expect(store.config).toEqual({ app: { name: 'SSR app' } });
  expect(loaded.calls).toEqual(['entered']);
  await runWithConfig(store, () => expect(requireConfigVariable('PORT', 'number')).toBe(81));
});
