import { CompiledQuery, type Kysely } from '@cossackframework/database';
import { OperationQueue } from './queue.js';
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
      const result = await this.client.executeQuery<Record<string, unknown>>(
        CompiledQuery.raw(sql, [...parameters]),
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

export function createLocalConnection(options: LocalConnectionOptions): LocalStudioConnection {
  return new LocalStudioConnection(options.client, options.info);
}
