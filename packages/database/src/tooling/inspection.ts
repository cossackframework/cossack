import { resolve } from 'node:path';
import { createORM, type ORM } from '../orm.js';
import type { ORMConfig, ORMToolingContext } from '../config.js';
import { inspectFinalizedMetadata, type EntityInspection } from '../metadata/inspection.js';
import { MigrationRunner } from '../migration/runner.js';
import { planTarget } from '../migration/plan.js';
import { ConfigurationError } from '../errors.js';
import { inspectProviderCapabilities, type ProviderCapabilityReport } from '../runtime-capabilities.js';
import { dialectFor } from '../dialect/dialects.js';
import type { OrmSchema } from '../schema/types.js';
import type { DriverCapabilities, DialectCapabilities } from '../adapter/types.js';

/** Stable shared facts, independent of Studio's editable row presentation. */
export interface DatabaseInspection {
  readonly schemaVersion: 1;
  readonly defaultValues: 'omitted';
  readonly dialect: ORM['driver']['dialect'];
  readonly target: Readonly<Record<string, string>>;
  readonly capabilities: { readonly driver: DriverCapabilities; readonly dialect: DialectCapabilities };
  readonly providerCapabilities: ProviderCapabilityReport;
  readonly schema: OrmSchema;
  readonly models: OrmSchema;
  readonly entities: readonly EntityInspection[];
  readonly migrations: readonly { name: string; checksum: string; state: 'pending' | 'applied' | 'changed'; appliedAt?: string; batch?: number }[];
  readonly history: readonly { name: string; checksum: string; appliedAt: string; batch: number }[];
}

export async function createORMFromConfig(config: ORMConfig, context?: ORMToolingContext): Promise<ORM> {
  const selected = context ?? { cwd: process.cwd(), configPath: resolve('orm.config.ts'), target: 'local', readOnly: false };
  if (selected.target === 'remote' && typeof config.adapter !== 'function') {
    throw new ConfigurationError('Remote tooling requires an adapter factory that accepts ORMToolingContext.');
  }
  const adapter = typeof config.adapter === 'function' ? await config.adapter(selected) : config.adapter;
  try {
    for (const [field, expected] of [['target', selected.target], ['environment', selected.environment]] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(adapter.tooling ?? {}, field);
      if (expected && descriptor && 'value' in descriptor && typeof descriptor.value === 'string' && descriptor.value !== expected) {
        throw new ConfigurationError('The adapter resolved a different database selection. Check its target and environment handling.');
      }
    }
    return createORM({ adapter, entities: config.entities,
      ...(config.namingStrategy === undefined ? {} : { namingStrategy: config.namingStrategy }),
      ...(config.logger === undefined ? {} : { logger: config.logger }) });
  } catch (error) {
    await adapter.driver.close();
    throw error;
  }
}

function structuralSchema(schema: OrmSchema): OrmSchema {
  return { ...schema, entities: schema.entities.map(entity => ({ ...entity,
    columns: entity.columns.map(({ default: _default, ...column }) => column) })) };
}

/** Inspect a borrowed connection. Its caller retains ownership and disposal. */
export async function inspectDatabase(orm: ORM, migrations: NonNullable<ORMConfig['migrations']> = []): Promise<DatabaseInspection> {
  return orm.run(async () => {
    const runner = new MigrationRunner(orm, migrations);
    const target: Record<string, string> = Object.fromEntries(Object.entries(planTarget(orm)).filter(([key]) => key !== 'connectionId'));
    const history = await runner.applied({ readOnly: true });
    const statuses = await runner.status({ readOnly: true });
    return {
      schemaVersion: 1, defaultValues: 'omitted', dialect: orm.driver.dialect, target,
      capabilities: { driver: { ...orm.driver.capabilities }, dialect: { ...dialectFor(orm.driver.dialect).capabilities } },
      providerCapabilities: inspectProviderCapabilities(orm.driver, target.provider),
      schema: structuralSchema(await orm.introspect()), models: structuralSchema(orm.schema()), entities: inspectFinalizedMetadata(orm.metadata),
      migrations: statuses.map(({ migration, checksum, state, applied }) => ({ name: migration.name, checksum, state,
        ...(applied ? { appliedAt: applied.appliedAt.toISOString(), batch: applied.batch } : {}) })),
      history: history.map(item => ({ name: item.name, checksum: item.checksum, appliedAt: item.appliedAt.toISOString(), batch: item.batch })),
    };
  });
}

/** Own a temporary connection and always close it, including inspection failure. */
export async function inspectConfiguredDatabase(config: ORMConfig, context: ORMToolingContext): Promise<DatabaseInspection> {
  const orm = await createORMFromConfig(config, { ...context, readOnly: true });
  try { return await inspectDatabase(orm, config.migrations); }
  finally { await orm.close(); }
}
