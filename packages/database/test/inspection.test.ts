import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createORM, BaseEntity, type ORMConfig } from '../src/index.js';
import { nodeSQLite } from '../src/runtime/node.js';
import { inspectConfiguredDatabase, inspectDatabase } from '../src/tooling/inspection.js';
import { runORMCommand } from '../src/tooling/index.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'cossack-inspection-')); roots.push(root); return root; }

it('shares physical/model metadata, capabilities, target and read-only migration facts without changing SQLite bytes', async () => {
  const root = await fixture(), filename = join(root, 'selected.sqlite');
  const adapter = await nodeSQLite({ filename });
  const close = vi.spyOn(adapter.driver, 'close');
  const orm = createORM({ adapter, entities: [] });
  await orm.executeFragment(orm.sql.unsafe("CREATE TABLE public_rows (id integer PRIMARY KEY, note text DEFAULT 'PRIVATE_INSPECTION_DEFAULT')"), 'ddl');
  const before = await readFile(filename);
  const result = await inspectDatabase(orm, [{ name: '001_declared', operations: { up: [], down: [] } }]);
  expect(result.schema.entities.map(entity => entity.tableName)).toEqual(['public_rows']);
  expect(result.models.entities).toEqual([]);
  expect(result.migrations).toMatchObject([{ name: '001_declared', state: 'pending' }]);
  expect(result.history).toEqual([]);
  expect(result.capabilities.driver.transactions).toBe(true);
  expect(JSON.stringify(result)).not.toContain('connectionId');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_INSPECTION_DEFAULT');
  expect(result.defaultValues).toBe('omitted');
  expect(await readFile(filename)).toEqual(before);
  expect(close).not.toHaveBeenCalled();
  await orm.close(); expect(close).toHaveBeenCalledTimes(1);
});

it.each([false, true])('owns disposal and requests readOnly on configured inspection, failure=%s', async fail => {
  const adapter = await nodeSQLite({ filename: ':memory:' }), close = vi.spyOn(adapter.driver, 'close');
  if (fail) vi.spyOn(adapter.driver, 'introspect').mockRejectedValueOnce(Error('private failure'));
  const contexts: unknown[] = [];
  const config: ORMConfig = { entities: [], adapter(context) { contexts.push(context); return adapter; } };
  const run = inspectConfiguredDatabase(config, { cwd: '.', configPath: 'orm.config.ts', target: 'remote', environment: 'staging', readOnly: false });
  if (fail) await expect(run).rejects.toThrow('private failure'); else expect((await run).history).toEqual([]);
  expect(contexts).toMatchObject([{ target: 'remote', environment: 'staging', readOnly: true }]);
  expect(close).toHaveBeenCalledTimes(1);
});

it('closes an adapter when invalid model metadata prevents ORM construction', async () => {
  const adapter = await nodeSQLite({ filename: ':memory:' }), close = vi.spyOn(adapter.driver, 'close');
  class Invalid extends BaseEntity {}
  await expect(inspectConfiguredDatabase({ entities: [Invalid], adapter }, { cwd: '.', configPath: 'orm.config.ts', target: 'local', readOnly: true })).rejects.toThrow();
  expect(close).toHaveBeenCalledTimes(1);
});

it('CLI schema inspect uses the shared read-only result with isolated JSON and exact selected environment', async () => {
  const root = await fixture();
  const configPath = join(root, 'orm.config.ts');
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  const adapterURL = new URL('../src/runtime/node.ts', import.meta.url).href;
  await writeFile(configPath, `import {nodeSQLite} from ${JSON.stringify(adapterURL)};
export default { entities: [], adapter: async(context) => {
const adapter=await nodeSQLite({filename:':memory:'});
return {...adapter,tooling:{provider:'sqlite',target:context.target,environment:context.environment,password:'PRIVATE_INSPECTION_SECRET'}};
}, migrations:[{name:'001_pending',operations:{up:[],down:[]}}] };`);
  const messages: string[] = [];
  const code = await runORMCommand(['schema', 'inspect', '--json', '--env=staging'], { cwd: root, configPath, stdout: message => messages.push(message) });
  expect(code, messages.join('\n')).toBe(0);
  expect(messages).toHaveLength(1);
  const result = JSON.parse(messages[0]!);
  expect(result.data.inspection).toMatchObject({ schemaVersion: 1, target: { provider: 'sqlite', target: 'local', environment: 'staging' }, history: [], migrations: [{ state: 'pending' }] });
  expect(messages[0]).not.toContain('PRIVATE_INSPECTION_SECRET');
});

it('rejects known mismatched environment/target before inspection and closes the adapter', async () => {
  const adapter = await nodeSQLite({ filename: ':memory:' });
  const close = vi.spyOn(adapter.driver, 'close'), introspect = vi.spyOn(adapter.driver, 'introspect');
  await expect(inspectConfiguredDatabase({ entities: [], adapter: () => ({ ...adapter, tooling: { provider: 'sqlite', target: 'local', environment: 'production' } }) },
    { cwd: '.', configPath: 'orm.config.ts', target: 'local', environment: 'staging', readOnly: true })).rejects.toThrow('different database selection');
  expect(introspect).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
});
