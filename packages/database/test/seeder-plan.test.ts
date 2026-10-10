import 'reflect-metadata';
import { it, expect } from 'vitest';
import { createORM } from '../src/orm.js';
import { nodeSQLite } from '../src/runtime/node.js';
import { SeederRunner } from '../src/seeding/runner.js';
import { MemoryDriver } from '../src/adapter/memory.js';

it('never runs seeder callbacks during planning and executes detached declared SQL on its displayed connection', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try { await orm.run(async () => {
    await orm.executeFragment(orm.sql.unsafe('CREATE TABLE seeded (id integer, value text)'), 'ddl');
    let calls = 0;
    const callback = new SeederRunner(orm, [{ name: 'callback', run() { calls++; throw Error('external effect'); } }]);
    const unknown = await callback.plan();
    expect(unknown).toMatchObject([{ direction: 'seed', complete: false, statements: [] }]);
    await expect(callback.applyPlan(unknown)).rejects.toThrow('incomplete'); expect(calls).toBe(0);
    const operations = [orm.sql.fragment`INSERT INTO seeded VALUES (${1}, ${'PRIVATE_SEED_VALUE'})`];
    const definition = { name: 'declared', operations, run() { calls++; } };
    const runner = new SeederRunner(orm, [definition]); const plan = await runner.plan();
    expect(plan).toMatchObject([{ complete: true, atomicity: 'transaction', target: { dialect: 'sqlite', connectionId: expect.any(String) },
      affectedObjects: ['seeded'], statements: [{ order: 1, parameterCount: 2 }] }]);
    expect(JSON.stringify(plan)).not.toContain('PRIVATE_SEED_VALUE');
    expect((await orm.executeFragment(orm.sql.unsafe('SELECT * FROM seeded'))).rows).toEqual([]);
    await expect(new SeederRunner(orm, [definition]).applyPlan(plan)).rejects.toThrow('foreign');
    expect(await runner.applyPlan(plan)).toMatchObject([{ name: 'declared', usedTransaction: true }]);
    expect(calls).toBe(0);
    expect((await orm.executeFragment(orm.sql.unsafe('SELECT id FROM seeded'))).rows).toEqual([{ id: 1 }]);
    const stale = await runner.plan(); operations[0] = orm.sql.fragment`INSERT INTO seeded VALUES (${2}, ${'changed'})`;
    await expect(runner.applyPlan(stale)).rejects.toThrow('stale');
  }); } finally { await orm.close(); }
});
it('rolls back failed declared seed SQL and marks unsupported transaction requirements incomplete', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try { await orm.run(async () => {
    await orm.executeFragment(orm.sql.unsafe('CREATE TABLE failures (id integer)'), 'ddl');
    const runner = new SeederRunner(orm, [{ name: 'failure', operations: [orm.sql.unsafe('INSERT INTO failures VALUES (1)'), orm.sql.unsafe('invalid SQL')] }]);
    await expect(runner.applyPlan(await runner.plan())).rejects.toThrow('failure');
    expect((await orm.executeFragment(orm.sql.unsafe('SELECT * FROM failures'))).rows).toEqual([]);
  }); } finally { await orm.close(); }
  const driver = new MemoryDriver(); Object.assign(driver.capabilities, { transactions: false });
  const provider = createORM({ adapter: { driver }, entities: [] });
  try {
    const runner = new SeederRunner(provider, [{ name: 'required', transaction: 'required', operations: [] }]);
    expect(await runner.plan()).toMatchObject([{ complete: false, reason: expect.stringContaining('unsupported'), atomicity: 'none' }]);
    expect(driver.statements).toEqual([]);
  } finally { await provider.close(); }
});

it('keeps approved seeder parameter values detached across asynchronous statement execution', async () => {
  let mutations = 0;
  let mutate = () => {};
  const orm = createORM({ adapter: await nodeSQLite(), entities: [], logger: event => {
    if (event.sql === 'INSERT INTO detached_seeds VALUES (?)' && mutations === 0) { mutations++; mutate(); }
  } });
  try { await orm.run(async () => {
    await orm.executeFragment(orm.sql.unsafe('CREATE TABLE detached_seeds (id integer)'), 'ddl');
    const fragment = orm.sql.fragment`INSERT INTO detached_seeds VALUES (${12})`;
    mutate = () => { (fragment.nodes.find(node => node.kind === 'value') as { value: number }).value = 99; };
    const runner = new SeederRunner(orm, [{ name: 'detached', operations: [orm.sql.unsafe('INSERT INTO detached_seeds VALUES (1)'), fragment] }]);
    await runner.applyPlan(await runner.plan());
    expect(mutations).toBe(1);
    expect((fragment.nodes.find(node => node.kind === 'value') as { value: number }).value).toBe(99);
    expect((await orm.executeFragment(orm.sql.unsafe('SELECT * FROM detached_seeds'))).rows).toEqual([{ id: 1 }, { id: 12 }]);
  }); } finally { await orm.close(); }
});
