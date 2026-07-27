import { CompiledQuery, type Kysely } from '@cossackframework/database';
import type { StudioProvider } from './schema-types.js';

const PROVIDER_ALIASES: Record<string, StudioProvider> = {
  d1: 'd1-local',
  'd1-local': 'd1-local',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  libsql: 'libsql',
  turso: 'libsql',
  pg: 'postgres',
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
};

export function normalizeStudioProvider(value: unknown): StudioProvider | undefined {
  if (typeof value !== 'string') return undefined;
  return PROVIDER_ALIASES[value.trim().toLowerCase()];
}

function providerFromUrl(value: string | undefined): StudioProvider | undefined {
  if (!value) return undefined;
  try {
    const protocol = new URL(value).protocol.replace(':', '').toLowerCase();
    return normalizeStudioProvider(protocol);
  } catch {
    return undefined;
  }
}

function runtimeDialectName(client: Kysely<any>): string {
  const names: string[] = [];
  try {
    names.push(client.introspection.constructor.name);
  } catch {}
  try {
    names.push(client.getExecutor().adapter.constructor.name);
  } catch {}
  return names.join(' ').toLowerCase();
}

type RuntimeCossackDialect = 'd1';

function runtimeCossackDialect(
  client: Kysely<any>,
): RuntimeCossackDialect | undefined {
  try {
    const dialect = (
      client.getExecutor().adapter as { cossackDialect?: unknown }
    ).cossackDialect;
    return dialect === 'd1' ? dialect : undefined;
  } catch {
    return undefined;
  }
}

function environmentProvider(
  environment: NodeJS.ProcessEnv,
): StudioProvider | undefined {
  const explicit = normalizeStudioProvider(
    environment.COSSACK_STUDIO_DRIVER ?? environment.DB_CONNECTION,
  );
  if (explicit) return explicit;
  const urlProvider = providerFromUrl(
    environment.DATABASE_URL ?? environment.POSTGRES_URL ?? environment.MYSQL_URL,
  );
  if (urlProvider) return urlProvider;
  if (environment.PGHOST || environment.PGDATABASE) return 'postgres';
  if (environment.MYSQL_HOST || environment.MYSQL_DATABASE) return 'mysql';
  if (environment.TURSO_URL) return 'libsql';
  if (environment.DB_PATH) return 'sqlite';
  if (environment.D1_LOCAL_PATH) return 'd1-local';
  return undefined;
}

/**
 * Detect the concrete dialect behind getCliClient().
 *
 * Kysely exposes its runtime adapter and introspector, which is more reliable
 * than inferring a driver from credentials. Environment hints remain useful
 * for custom dialect wrappers and for distinguishing the SQLite family.
 */
export async function detectStudioProvider(
  client: Kysely<any>,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<StudioProvider> {
  if (runtimeCossackDialect(client) === 'd1') return 'd1-local';

  const runtimeName = runtimeDialectName(client);
  if (runtimeName.includes('postgres')) return 'postgres';
  if (runtimeName.includes('mysql')) return 'mysql';

  const hint = environmentProvider(environment);
  if (runtimeName.includes('sqlite')) {
    return hint === 'libsql' || hint === 'd1-local' || hint === 'sqlite'
      ? hint
      : 'sqlite';
  }
  if (hint) return hint;

  // Custom Kysely dialects may not use the built-in class names. These probes
  // are read-only and only run when runtime metadata and environment hints
  // were inconclusive.
  try {
    const result = await client.executeQuery<Record<string, unknown>>(
      CompiledQuery.raw('SELECT version() AS version'),
    );
    const version = String(result.rows[0]?.version ?? '').toLowerCase();
    if (version.includes('postgres')) return 'postgres';
    if (version.includes('mysql') || version.includes('mariadb')) return 'mysql';
  } catch {}
  try {
    await client.executeQuery(CompiledQuery.raw('SELECT sqlite_version() AS version'));
    return 'sqlite';
  } catch {}
  return 'unknown';
}

export function databaseLabelFromEnvironment(
  provider: StudioProvider,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = environment.DATABASE_URL ??
    (provider === 'postgres' ? environment.POSTGRES_URL : undefined) ??
    (provider === 'mysql' ? environment.MYSQL_URL : undefined);
  if (url) {
    try {
      const parsed = new URL(url);
      const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      if (database) return database;
      if (parsed.hostname) return parsed.hostname;
    } catch {}
  }
  if (provider === 'postgres') return environment.PGDATABASE;
  if (provider === 'mysql') return environment.MYSQL_DATABASE;
  return undefined;
}
