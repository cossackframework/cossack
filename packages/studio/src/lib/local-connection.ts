import { CompiledQuery, sql, type Kysely, type RawBuilder } from '@cossackframework/database';
import { OperationQueue } from './queue.js';
import { splitSqlParameters } from './sql.js';
import type {
  StudioConnection,
  StudioConnectionInfo,
  StudioQueryResult,
} from './types.js';

export interface LocalConnectionOptions {
  client: Kysely<any>;
  info?: Partial<StudioConnectionInfo>;
}

export class LocalStudioConnection implements StudioConnection {
  readonly info: StudioConnectionInfo;
  private readonly queue = new OperationQueue();

  constructor(private readonly client: Kysely<any>, info: Partial<StudioConnectionInfo> = {}) {
    this.info = {
      provider: info.provider ?? 'unknown',
      label: info.label ?? 'Local database',
      remote: false,
      ...info,
    };
  }

  execute(sql: string, parameters: readonly unknown[] = []): Promise<StudioQueryResult> {
    return this.queue.run(async () => {
      const started = performance.now();
      let query = CompiledQuery.raw(sql);
      if (parameters.length) {
        const fragments = splitSqlParameters(sql, parameters.length);
        let builder: RawBuilder<unknown> = sqlApi.raw(fragments[0]);
        for (let index = 0; index < parameters.length; index++) {
          builder = sqlApi`${builder}${parameters[index]}${sqlApi.raw(fragments[index + 1])}`;
        }
        query = builder.compile(this.client);
      }
      const result = await this.client.executeQuery<Record<string, unknown>>(
        query,
      );
      return {
        rows: [...result.rows],
        affectedRows: Number(result.numAffectedRows ?? 0),
        insertId: result.insertId === undefined ? undefined : String(result.insertId),
        durationMs: performance.now() - started,
      };
    });
  }

  close(): Promise<void> {
    return this.queue.close(async () => {
      await this.client.destroy();
    });
  }
}

// Avoid shadowing the execute() argument while keeping Kysely's template-tag
// parameter compilation local to this Node-only connection.
const sqlApi = sql;

export function createLocalConnection(options: LocalConnectionOptions): LocalStudioConnection {
  return new LocalStudioConnection(options.client, options.info);
}
