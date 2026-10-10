import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Run only after the coordinator installs the final release tarballs into this gate.
const root = path.resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Usage: node scripts/verify-database-inspection.mjs <installedRoot>');
const require = createRequire(path.join(root, 'package.json'));
const execute = promisify(execFile);
async function installed(specifier) {
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e',
    `console.log(import.meta.resolve(${JSON.stringify(specifier)}))`], { cwd: root, timeout: 30000 });
  const filename = await fs.realpath(fileURLToPath(stdout.trim()));
  assert(filename.startsWith(root + path.sep), `${specifier} resolved outside the installed gate`);
  assert(!filename.includes('/Sites/cossack/'), `${specifier} resolved into the repository`);
  return import(pathToFileURL(filename).href);
}
const db = await installed('@cossackframework/database');
const { nodeSQLite } = await installed('@cossackframework/database/node');
const tooling = await installed('@cossackframework/database/tooling');
const { inspectStudioDatabase } = await installed('@cossackframework/studio');
const cossackRoot = path.dirname(require.resolve('cossack/package.json'));
assert((await fs.realpath(cossackRoot)).startsWith(root + path.sep));
const directory = await fs.mkdtemp(path.join(root, '.inspection-acceptance-'));
const filename = path.join(directory, 'acceptance.sqlite');
let orm;
try {
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'inspection-acceptance', type: 'module', dependencies: { '@cossackframework/database': '0.8.3' } }));
  class OrderedRecord extends db.BaseEntity {}
  db.Entity({ tableName: 'ordered_records' })(OrderedRecord);
  db.PrimaryGeneratedColumn()(OrderedRecord.prototype, 'id');
  db.Column({ type: 'integer' })(OrderedRecord.prototype, 'rank');
  db.Column({ type: 'text', default: 'PRIVATE_DEFAULT' })(OrderedRecord.prototype, 'name');
  const events = [];
  orm = db.createORM({ adapter: await nodeSQLite({ filename }), entities: [OrderedRecord], logger: event => events.push(event) });
  await orm.run(async () => {
    await new db.SchemaBuilder().createTable(orm.schema().entities[0]).execute(orm);
    for (let index = 0; index < 6; index++) {
      const record = OrderedRecord.create({ rank: 1, name: 'PRIVATE_PARAMETER' });
      await record.save(); assert.equal(record.id, index + 1);
    }
    assert.deepEqual(await Promise.all([0, 2, 4].map(async offset => (await OrderedRecord.query().orderBy('rank').offset(offset).limit(2).getMany()).map(row => row.id))), [[1, 2], [3, 4], [5, 6]]);
    assert.deepEqual((await OrderedRecord.query().offset(4).getMany()).map(row => row.id), [5, 6]);
    await orm.executeFragment(orm.sql.unsafe("SELECT 'PRIVATE_LITERAL', 123 /* PRIVATE_COMMENT */"));
    await assert.rejects(orm.executeFragment(orm.sql.unsafe("SELECT 'PRIVATE_FAILURE_LITERAL' FROM missing_private_table")));
  });
  assert(!JSON.stringify(events).includes('PRIVATE_'));
  assert(events.some(event => event.outcome === 'failure' && event.code === 'COSSACK_DATABASE_QUERY_FAILED'));
  assert(events.every(event => !Object.hasOwn(event, 'error') && Number.isFinite(event.durationMs)));
  assert(orm.inspectCapabilities().transactions.interactive);
  assert(orm.inspectCapabilities().generated.increment);
  assert(!JSON.stringify(orm.inspectMetadata()).includes('PRIVATE_DEFAULT'));
  await orm.close(); orm = undefined;
  const configPath = path.join(directory, 'orm.config.ts');
  await fs.writeFile(configPath, `import {nodeSQLite} from '@cossackframework/database/node';
export default {entities:[],migrations:[{name:'001_pending',operations:{up:[],down:[]}}],adapter:async(context:any)=>{
if(context.environment!=='staging'||!context.readOnly)throw Error('Explicit read-only staging required');
const adapter=await nodeSQLite({filename:${JSON.stringify(filename)}});
return {...adapter,tooling:{provider:'sqlite',target:context.target,environment:context.environment,binding:'STAGING_DB',password:'PRIVATE_PASSWORD'}};}};`);
  const before = await fs.readFile(filename);
  const config = await tooling.loadORMConfig(configPath);
  const context = { cwd: directory, configPath, environment: 'staging', target: 'local', readOnly: true };
  const shared = await tooling.inspectConfiguredDatabase(config, context);
  assert.deepEqual(await inspectStudioDatabase(config, context), shared);
  assert.deepEqual(shared.history, []);
  assert.equal(shared.migrations[0].state, 'pending');
  assert(!shared.schema.entities.some(entity => entity.tableName === '_cossack_migrations'));
  assert(!JSON.stringify(shared).includes('PRIVATE_PASSWORD'));
  assert(!JSON.stringify(shared).includes('PRIVATE_DEFAULT'));
  assert.equal(shared.defaultValues, 'omitted');
  const { stdout } = await execute(process.execPath, [path.join(cossackRoot, 'bin/cossack.js'), 'schema', 'inspect', '--json', '--env=staging'], { cwd: directory, timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.deepEqual(JSON.parse(stdout).data.inspection, shared);
  assert.deepEqual(await fs.readFile(filename), before);
  const types = path.join(directory, 'public-types.ts');
  await fs.writeFile(types, `import {BaseEntity,createORM,type ORMConfig} from '@cossackframework/database';
import {nodeSQLite} from '@cossackframework/database/node';
import {inspectConfiguredDatabase,type DatabaseInspection} from '@cossackframework/database/tooling';
import {inspectStudioDatabase} from '@cossackframework/studio';
const config:ORMConfig={entities:[],adapter:async()=>nodeSQLite()};
const context={cwd:'.',configPath:'orm.config.ts',target:'local' as const,readOnly:true};
const result:Promise<DatabaseInspection>=inspectStudioDatabase(config,context);
void inspectConfiguredDatabase(config,context);void createORM;void BaseEntity;void result;
// @ts-expect-error Unsupported target must be rejected.
inspectStudioDatabase(config,{...context,target:'unknown'});
// @ts-expect-error readOnly must be boolean.
inspectConfiguredDatabase(config,{...context,readOnly:'yes'});
`);
  const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  await execute(process.execPath, [compiler, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ESNext', types], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
  console.log('Installed RT15/RT17 SQLite behavior, redaction, public types, and CLI/Studio inspection parity passed. PostgreSQL/MySQL live endpoint checks are not performed by this helper.');
} finally {
  await orm?.close();
  await fs.rm(directory, { recursive: true, force: true });
}
