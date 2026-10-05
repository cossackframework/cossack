import type { ORM } from '../orm.js';
import type { SchemaOperation } from '../schema/operations.js';
import { renderOperation } from '../schema/ddl.js';
import { dialectFor } from '../dialect/dialects.js';
import { compileSQL, SQLFragment } from '../sql/fragment.js';
import type { MigrationOperation, MigrationPlanStatement, DatabasePlanTarget } from './types.js';

const connections = new WeakMap<object, string>();
export function planTarget(orm: ORM): DatabasePlanTarget {
  let connectionId = connections.get(orm.driver);
  if (!connectionId) { connectionId = crypto.randomUUID(); connections.set(orm.driver, connectionId); }
  const target: Record<string, string> = { dialect: orm.driver.dialect, connectionId };
  if (orm.tooling && typeof orm.tooling === 'object') {
    for (const field of ['provider', 'target', 'accountId', 'environment', 'binding', 'databaseName', 'databaseId']) {
      const descriptor = Object.getOwnPropertyDescriptor(orm.tooling, field);
      if (!descriptor || !('value' in descriptor)) continue;
      const value: unknown = descriptor.value;
      if (typeof value !== 'string' || value.length < 1 || value.length > 128) continue;
      if (field === 'target' ? value !== 'local' && value !== 'remote' : !/^[a-zA-Z0-9_][a-zA-Z0-9_.:-]*$/.test(value)) continue;
      target[field] = value;
    }
  }
  return Object.freeze(target) as DatabasePlanTarget;
}
export function executionPolicy(orm: ORM): { atomicity: 'transaction' | 'batch' | 'none'; limitations: readonly string[] } {
  const driver = orm.driver;
  const atomicity = driver.capabilities.transactions && driver.transaction ? 'transaction'
    : driver.capabilities.batch && driver.batch ? 'batch' : 'none';
  const limitations = [
    ...(atomicity === 'none' ? ['This provider cannot atomically apply SQL and migration history. Failure may leave partial changes.'] : []),
    ...(driver.dialect === 'mysql' ? ['MySQL DDL can commit implicitly; a transaction does not guarantee schema rollback.'] : []),
    'Planning does not validate remote connectivity or data-dependent SQL effects.',
  ];
  return { atomicity, limitations: Object.freeze(limitations) };
}
export function serializeEvidence(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? { bigint: String(item) } : item);
}
export async function digestEvidence(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeEvidence(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function operationStatements(operations: readonly MigrationOperation[], orm: ORM): readonly MigrationPlanStatement[] {
  const dialect = dialectFor(orm.driver.dialect);
  return Object.freeze(operations.flatMap<Omit<MigrationPlanStatement, "order">>(operation => {
    if (operation instanceof SQLFragment) {
      const query = compileSQL(operation, dialect);
      const objects = [...query.text.matchAll(/\b(?:TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?|INTO\s+|UPDATE\s+|FROM\s+|INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?)["`]?([a-zA-Z_][\w.]*)/gi)]
        .map(match => match[1]!);
      const risk = /\b(DROP|TRUNCATE|DELETE|REPLACE)\b/i.test(query.text) ? 'destructive'
        : /^\s*(?:CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)|INSERT\s+INTO)\b/i.test(query.text) ? 'safe' : 'unknown';
      return [Object.freeze({ text: query.text, parameterCount: query.parameters.length, risk,
        affectedObjects: Object.freeze([...new Set(objects)]), affectedObjectsComplete: false })];
    }
    const item = operation as SchemaOperation;
    const affectedObjects = item.kind === 'create-table' ? [item.entity.tableName]
      : item.kind === 'rename-table' ? [item.from, item.to] : [item.tableName];
    const risk = ['drop-table', 'drop-column', 'alter-column'].includes(item.kind) ? 'destructive' as const : 'safe' as const;
    return renderOperation(item, dialect).map(text => Object.freeze({ text, parameterCount: 0, risk,
      affectedObjects: Object.freeze(affectedObjects), affectedObjectsComplete: true }));
  }).map((statement, index) => Object.freeze({ ...statement, order: index + 1 })));
}

/** Detach executable values so later application mutations cannot change an approved batch. */
export function snapshotOperation(operation: MigrationOperation): MigrationOperation {
  if (!(operation instanceof SQLFragment)) return structuredClone(operation);
  return new SQLFragment(operation.nodes.map(node => node.kind === 'fragment'
    ? { ...node, value: snapshotOperation(node.value) as SQLFragment }
    : structuredClone(node)));
}
