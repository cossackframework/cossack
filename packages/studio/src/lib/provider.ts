import type { ORM } from '@cossackframework/database';
import type { StudioProvider } from './schema-types.js';

const PROVIDER_ALIASES: Record<string, StudioProvider> = {
  d1: 'd1-local',
  'd1-local': 'd1-local',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  turso: 'turso',
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
    return normalizeStudioProvider(new URL(value).protocol.replace(':', ''));
  } catch {
    return undefined;
  }
}

function environmentProvider(environment: NodeJS.ProcessEnv): StudioProvider | undefined {
  const explicit = normalizeStudioProvider(
    environment.COSSACK_STUDIO_DRIVER ?? environment.DB_CONNECTION,
  );
  if (explicit) return explicit;
  const url = providerFromUrl(
    environment.DATABASE_URL ?? environment.POSTGRES_URL ?? environment.MYSQL_URL,
  );
  if (url) return url;
  if (environment.PGHOST || environment.PGDATABASE) return 'postgres';
  if (environment.MYSQL_HOST || environment.MYSQL_DATABASE) return 'mysql';
  if (environment.TURSO_DATABASE_URL) return 'turso';
  if (environment.D1_LOCAL_PATH) return 'd1-local';
  if (environment.DB_PATH) return 'sqlite';
  return undefined;
}

export async function detectStudioProvider(
  orm: ORM,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<StudioProvider> {
  const hint = environmentProvider(environment);
  if (orm.driver.dialect === 'postgres') return 'postgres';
  if (orm.driver.dialect === 'mysql') return 'mysql';
  if (hint === 'd1-local' || hint === 'turso' || hint === 'sqlite') return hint;
  return orm.driver.dialect === 'sqlite' ? 'sqlite' : 'unknown';
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
      return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) ||
        parsed.hostname ||
        undefined;
    } catch {}
  }
  if (provider === 'postgres') return environment.PGDATABASE;
  if (provider === 'mysql') return environment.MYSQL_DATABASE;
  return undefined;
}
