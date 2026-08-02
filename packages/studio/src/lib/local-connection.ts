import type { ORM, OrmSchema } from '@cossackframework/orm';
import { OperationQueue } from './queue.js';
import type {
  StudioConnection,
  StudioConnectionInfo,
  StudioQueryResult,
} from './schema-types.js';

export interface LocalConnectionOptions {
  orm: ORM;
  info?: Partial<StudioConnectionInfo>;
}

export class LocalStudioConnection implements StudioConnection {
  readonly info: StudioConnectionInfo;
  readonly logicalSchema: OrmSchema;
  private readonly queue = new OperationQueue();

  constructor(private readonly orm: ORM, info: Partial<StudioConnectionInfo> = {}) {
    this.logicalSchema = orm.schema();
    this.info = {
      provider: info.provider ?? 'unknown',
      label: info.label ?? 'Local database',
      remote: false,
      ...info,
    };
  }

  execute(text: string, parameters: readonly unknown[] = []): Promise<StudioQueryResult> {
    return this.queue.run(() => this.orm.run(async () => {
      const started = performance.now();
      const result = await this.orm.driver.execute(
        { text, parameters: parameters as import('@cossackframework/orm').CompiledQuery['parameters'] },
        'raw',
      );
      return {
        rows: [...result.rows] as Record<string, unknown>[],
        affectedRows: Number(result.meta.rowsAffected ?? 0),
        ...(result.meta.lastInsertId === undefined
          ? {}
          : { insertId: String(result.meta.lastInsertId) }),
        durationMs: performance.now() - started,
      };
    }));
  }

  close(): Promise<void> {
    return this.queue.close(() => this.orm.close());
  }
}

export function createLocalConnection(options: LocalConnectionOptions): LocalStudioConnection {
  return new LocalStudioConnection(options.orm, options.info);
}
