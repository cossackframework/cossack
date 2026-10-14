import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createORM, MigrationRunner, type ORMConfig, type ORMToolingContext } from '@cossackframework/database';
import { nodeSQLite } from '@cossackframework/database/node';
import { inspectConfiguredDatabase, loadORMConfig, runORMCommand } from '@cossackframework/database/tooling';
import { inspectStudioDatabase, inspectStudioProject } from '../src/lib/inspection';
import { createLocalConnection } from '../src/lib/local-connection';
import { StudioDatabase } from '../src/lib/service';

const roots: string[] = [];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'cossack-studio-inspection-'));roots.push(root);
  const filename=join(root,'staging.sqlite');
  const orm=createORM({adapter:await nodeSQLite({filename}),entities:[]});
  try {
    await orm.executeFragment(orm.sql.unsafe('CREATE TABLE inspection_departments (id INTEGER PRIMARY KEY)'), 'ddl');
    await orm.executeFragment(orm.sql.unsafe('CREATE TABLE inspection_people (id INTEGER PRIMARY KEY, department_id INTEGER NOT NULL REFERENCES inspection_departments(id))'), 'ddl');
    await new MigrationRunner(orm,[{name:'001_applied',operations:{up:[],down:[]}},{name:'002_changed',operations:{up:[],down:[]}}]).up();
  }finally{await orm.close();}
  const packageRoot=resolve(fileURLToPath(new URL('../../database/',import.meta.url)));
  await mkdir(join(root,'node_modules/@cossackframework'),{recursive:true});
  await symlink(packageRoot,join(root,'node_modules/@cossackframework/database'),'junction');
  await writeFile(join(root,'package.json'),JSON.stringify({type:'module',private:true}));
  await writeFile(join(root,'orm.config.ts'),`import {appendFile} from 'node:fs/promises';
import {BaseEntity,Entity,PrimaryColumn,Column,ManyToOne,OneToMany,JoinColumn} from '@cossackframework/database';
import {nodeSQLite} from '@cossackframework/database/node';
class InspectionDepartment extends BaseEntity{} class InspectionPerson extends BaseEntity{}
Entity({tableName:'inspection_departments'})(InspectionDepartment);PrimaryColumn({type:'integer'})(InspectionDepartment.prototype,'id');
Entity({tableName:'inspection_people'})(InspectionPerson);PrimaryColumn({type:'integer'})(InspectionPerson.prototype,'id');Column({type:'integer',name:'department_id'})(InspectionPerson.prototype,'departmentId');
ManyToOne(()=>InspectionDepartment,(department:any)=>department.people)(InspectionPerson.prototype,'department');JoinColumn({name:'department_id',referencedColumnName:'id'})(InspectionPerson.prototype,'department');
OneToMany(()=>InspectionPerson,(person:any)=>person.department)(InspectionDepartment.prototype,'people');
export default {entities:[InspectionDepartment,InspectionPerson],migrations:[{name:'001_applied',operations:{up:[],down:[]}},{name:'002_changed',operations:{up:[{kind:'drop-table',tableName:'not_executed'}],down:[]}},{name:'003_pending',operations:{up:[],down:[]}}],
adapter:async(context:any)=>{await appendFile(${JSON.stringify(join(root,'trace.jsonl'))},JSON.stringify({event:'open',...context})+'\\n');
if(context.environment!=='staging')throw new Error('Explicit staging environment required');
const adapter=await nodeSQLite({filename:${JSON.stringify(filename)}});const close=adapter.driver.close.bind(adapter.driver);adapter.driver.close=async()=>{await close();await appendFile(${JSON.stringify(join(root,'trace.jsonl'))},JSON.stringify({event:'close'})+'\\n');};
return {...adapter,tooling:{provider:'sqlite',target:context.target,environment:context.environment,binding:'STAGING_DB',password:'PRIVATE_STUDIO_INSPECTION_SECRET'}};}};
`);
  return {root,filename,configPath:join(root,'orm.config.ts')};
}

it('returns equivalent actual CLI, shared and Studio browser-schema facts without changing SQLite bytes',async()=>{
  const {root,filename,configPath}=await fixture();const before=await readFile(filename);
  const context:ORMToolingContext={cwd:root,configPath,environment:'staging',target:'local',readOnly:true};
  const config=await loadORMConfig(configPath);
  const shared=await inspectConfiguredDatabase(config,context);
  const configured=await inspectStudioDatabase(config,context);
  const project=await inspectStudioProject({projectRoot:root,environment:'staging',binding:'STAGING_DB'});
  const output:string[]=[];
  expect(await runORMCommand(['schema','inspect','--json','--env=staging'],{cwd:root,configPath,stdout:text=>output.push(text)})).toBe(0);
  expect(output).toHaveLength(1);const cli=JSON.parse(output[0]!).data.inspection;
  expect(configured).toEqual(shared);expect(project).toEqual(shared);expect(cli).toEqual(shared);
  const adapter=await (config.adapter as (context:ORMToolingContext)=>ReturnType<typeof nodeSQLite>)(context);
  const connection=createLocalConnection({orm:createORM({adapter,entities:config.entities}),migrations:config.migrations,info:{provider:'sqlite',environment:'staging',binding:'STAGING_DB'}});
  try {
    const studio=new StudioDatabase(connection);
    expect((await studio.getSchema(true)).inspection).toBeUndefined();
    expect(await studio.getInspection()).toEqual(shared);
    const browserSchema=await studio.getSchema();
    expect(browserSchema.inspection).toEqual(shared);
    expect(browserSchema.objects.some(object=>object.name==='_cossack_migrations')).toBe(false);
    expect(browserSchema.objects.find(object=>object.name==='inspection_people')?.relations).toEqual([expect.objectContaining({propertyName:'department',kind:'many-to-one',targetTableName:'inspection_departments'})]);
    expect(shared.models.entities.find(entity=>entity.tableName==='inspection_people')?.relations).toEqual([expect.objectContaining({propertyName:'department',kind:'many-to-one'})]);
    expect(shared.migrations.map(migration=>migration.state)).toEqual(['applied','changed','pending']);expect(shared.history).toHaveLength(2);
    expect(JSON.stringify(browserSchema.inspection)).not.toContain('PRIVATE_STUDIO_INSPECTION_SECRET');
  }finally{await connection.close();}
  expect(await readFile(filename)).toEqual(before);
  const trace=(await readFile(join(root,'trace.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(trace.filter(event=>event.event==='open')).toHaveLength(5);expect(trace.filter(event=>event.event==='close')).toHaveLength(5);
  expect(trace.filter(event=>event.event==='open').every(event=>event.environment==='staging'&&event.readOnly===true)).toBe(true);
});

it('inspects an empty migration history without creating bookkeeping or changing database bytes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cossack-studio-no-history-'));roots.push(root);const filename=join(root,'data.sqlite');
  const orm=createORM({adapter:await nodeSQLite({filename}),entities:[]});
  await orm.executeFragment(orm.sql.unsafe('CREATE TABLE public_rows (id INTEGER PRIMARY KEY)'), 'ddl');const before=await readFile(filename);
  const connection=createLocalConnection({orm,migrations:[{name:'001_pending',operations:{up:[],down:[]}}],info:{provider:'sqlite'}});
  try{const studio=new StudioDatabase(connection);await studio.getInspection();const schema=await studio.getSchema(true);expect(schema.inspection).toBeUndefined();const inspected=await studio.getInspection();expect(inspected?.history).toEqual([]);expect((await studio.getSchema()).inspection?.migrations).toMatchObject([{state:'pending'}]);expect(inspected?.schema.entities.map(entity=>entity.tableName)).toEqual(['public_rows']);expect(await readFile(filename)).toEqual(before);}
  finally{await connection.close();}
});

it.each([false,true])('closes temporary Studio connections on success/failure and passes exact read-only selection, failure=%s',async fail=>{
  const adapter=await nodeSQLite({filename:':memory:'});const close=vi.spyOn(adapter.driver,'close');if(fail)vi.spyOn(adapter.driver,'introspect').mockRejectedValueOnce(new Error('inspection failed'));
  const contexts:ORMToolingContext[]=[];const config:ORMConfig={entities:[],adapter(context){contexts.push(context);return adapter;}};
  const run=inspectStudioDatabase(config,{cwd:'.',configPath:'orm.config.ts',environment:'staging',target:'remote',readOnly:false});
  if(fail)await expect(run).rejects.toThrow('inspection failed');else expect((await run).history).toEqual([]);
  expect(contexts).toMatchObject([{environment:'staging',target:'remote',readOnly:true}]);expect(close).toHaveBeenCalledTimes(1);
});

it('closes a temporary adapter when invalid model construction fails',async()=>{
  const adapter=await nodeSQLite({filename:':memory:'});const close=vi.spyOn(adapter.driver,'close');class InvalidModel{}
  // @ts-expect-error Deliberately invalid entity proves construction failure releases the adapter.
  await expect(inspectStudioDatabase({adapter,entities:[InvalidModel]},{cwd:'.',configPath:'orm.config.ts',target:'local',readOnly:true})).rejects.toThrow();expect(close).toHaveBeenCalledTimes(1);
});

it('rejects missing named selection or a different binding after releasing the inspected connection',async()=>{
  const {root}=await fixture();
  await expect(inspectStudioProject({projectRoot:root})).rejects.toThrow('Explicit staging environment required');
  await expect(inspectStudioProject({projectRoot:root,environment:'staging',binding:'TOP_LEVEL_DB'})).rejects.toThrow('does not match');
  const trace=(await readFile(join(root,'trace.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(trace.filter(event=>event.event==='close')).toHaveLength(1);
});
