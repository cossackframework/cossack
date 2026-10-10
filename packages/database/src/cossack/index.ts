import { cacheKey, cacheKeys, cacheExpiry as validatedCacheExpiry, cacheJson, prepareCacheEntries } from "./cache-policy.js";
import type { ORM } from "../orm.js";
import { currentORM } from "../scope.js";
import type { SQLFragment } from "../sql/fragment.js";

export interface MiddlewareContext {
  set?(key: string, value: unknown): void;
  get?(key: string): unknown;
}

interface ResponseLifetime {
  deferCleanup(cleanup: () => Promise<void>): boolean;
}

function responseLifetime(value: unknown): value is ResponseLifetime {
  return value !== null && typeof value === "object" && "deferCleanup" in value &&
    typeof value.deferCleanup === "function";
}

export type MiddlewareNext = () => Promise<void>;
export type ORMFactory<Context extends MiddlewareContext = MiddlewareContext> =
  (context: Context) => ORM | Promise<ORM>;

/**
 * Scope an ORM to all downstream request work.
 *
 * An ORM instance is caller-owned and is never closed by middleware. An ORM
 * created by a request factory is owned by middleware and is always closed,
 * including when downstream throws. A framework streaming response can retain
 * cleanup until its body completes or is cancelled.
 */
export function ormMiddleware<Context extends MiddlewareContext>(
  source: ORM | ORMFactory<Context>,
  contextKey = "orm",
) {
  return async (context: Context, next: MiddlewareNext): Promise<void> => {
    const ownsORM = typeof source === "function";
    const orm = ownsORM ? await source(context) : source;
    try {
      await orm.run(async () => {
        context.set?.(contextKey, orm.currentScopedORM());
        await next();
      });
    } finally {
      if (ownsORM) {
        const lifetime = context.get?.("cossack:response-lifetime");
        if (!responseLifetime(lifetime) || !lifetime.deferCleanup(() => orm.close())) {
          await orm.close();
        }
      }
    }
  };
}

export interface CacheEntry<T = unknown> {
  readonly key: string;
  readonly value: T;
  readonly ttlMs?: number;
}

const DATABASE_CACHE_CAPABILITIES = Object.freeze({
  kind: 'cache' as const, provider: 'database', durationUnit: 'milliseconds' as const,
  locality: 'unknown' as const, persistence: 'unknown' as const, consistency: 'unknown' as const,
  atomicIncrement: false as const, expiryPrecision: 'milliseconds' as const,
  operations: Object.freeze(['get', 'set', 'has', 'delete', 'flush', 'getMany', 'setMany', 'deleteMany'] as const),
});

export interface CacheStore {
  readonly capabilities?: typeof DATABASE_CACHE_CAPABILITIES;
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  flush(): Promise<void>;
  getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
  setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
}

function resolveORM(explicit?: ORM): ORM {
  const orm = explicit ?? currentORM();
  if (!orm) {
    throw new Error(
      "[Cossack] No ORM in scope. Register ormMiddleware() or pass an explicit ORM instance.",
    );
  }
  return orm;
}

function cacheExpiry(ttlMs?: number): number | null {
  return validatedCacheExpiry(ttlMs) ?? null;
}

function cacheExpired(value: unknown): boolean {
  return value !== null && value !== undefined && Number(value) <= Date.now();
}

export function createDatabaseCacheStore(
  orm?: ORM,
  options: { readonly tableName?: string } = {},
): CacheStore {
  const table = options.tableName ?? "cache_items";
  const getORM = () => resolveORM(orm);
  return {
    capabilities: DATABASE_CACHE_CAPABILITIES,
    async get<T>(key: string): Promise<T | undefined> {
      cacheKey(key);
      const scoped = getORM();
      const result = await scoped.executeFragment<Record<string, unknown>>(scoped.sql.fragment`
        SELECT ${scoped.sql.id("value")}, ${scoped.sql.id("expires_at")}
        FROM ${scoped.sql.id(table)}
        WHERE ${scoped.sql.id("key")} = ${key}
        LIMIT 1
      `, "select");
      const row = result.rows[0];
      if (!row) return undefined;
      if (cacheExpired(row["expires_at"])) {
        await scoped.executeFragment(scoped.sql.fragment`
          DELETE FROM ${scoped.sql.id(table)}
          WHERE ${scoped.sql.id("key")} = ${key}
            AND ${scoped.sql.id("value")} = ${String(row["value"])}
            AND (${scoped.sql.id("expires_at")} = ${row["expires_at"] == null ? null : Number(row["expires_at"])}
              OR (${scoped.sql.id("expires_at")} IS NULL AND ${row["expires_at"] == null ? null : Number(row["expires_at"])} IS NULL))
        `, "delete");
        return undefined;
      }
      try {
        return JSON.parse(String(row["value"])) as T;
      } catch {
        await scoped.executeFragment(scoped.sql.fragment`
          DELETE FROM ${scoped.sql.id(table)}
          WHERE ${scoped.sql.id("key")} = ${key}
            AND ${scoped.sql.id("value")} = ${String(row["value"])}
            AND (${scoped.sql.id("expires_at")} = ${row["expires_at"] == null ? null : Number(row["expires_at"])}
              OR (${scoped.sql.id("expires_at")} IS NULL AND ${row["expires_at"] == null ? null : Number(row["expires_at"])} IS NULL))
        `, "delete");
        return undefined;
      }
    },
    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
      cacheKey(key);
      const expiresAt = cacheExpiry(ttlMs);
      const json = cacheJson(value);
      if (json === undefined || ttlMs === 0) return this.delete(key);
      const scoped = getORM();
      const updatedAt = Date.now();
      const fragment = scoped.driver.dialect === "mysql"
        ? scoped.sql.fragment`
          INSERT INTO ${scoped.sql.id(table)}
            (${scoped.sql.id("key")}, ${scoped.sql.id("value")}, ${scoped.sql.id("expires_at")}, ${scoped.sql.id("updated_at")})
          VALUES (${key}, ${json}, ${expiresAt}, ${updatedAt})
          ON DUPLICATE KEY UPDATE
            ${scoped.sql.id("value")} = VALUES(${scoped.sql.id("value")}),
            ${scoped.sql.id("expires_at")} = VALUES(${scoped.sql.id("expires_at")}),
            ${scoped.sql.id("updated_at")} = VALUES(${scoped.sql.id("updated_at")})
        `
        : scoped.sql.fragment`
          INSERT INTO ${scoped.sql.id(table)}
            (${scoped.sql.id("key")}, ${scoped.sql.id("value")}, ${scoped.sql.id("expires_at")}, ${scoped.sql.id("updated_at")})
          VALUES (${key}, ${json}, ${expiresAt}, ${updatedAt})
          ON CONFLICT (${scoped.sql.id("key")}) DO UPDATE SET
            ${scoped.sql.id("value")} = excluded.${scoped.sql.id("value")},
            ${scoped.sql.id("expires_at")} = excluded.${scoped.sql.id("expires_at")},
            ${scoped.sql.id("updated_at")} = excluded.${scoped.sql.id("updated_at")}
        `;
      await scoped.executeFragment(fragment, "insert");
    },
    async has(key: string): Promise<boolean> {
      return (await this.get(key)) !== undefined;
    },
    async delete(key: string): Promise<void> {
      cacheKey(key);
      const scoped = getORM();
      await scoped.executeFragment(
        scoped.sql.fragment`DELETE FROM ${scoped.sql.id(table)} WHERE ${scoped.sql.id("key")} = ${key}`,
        "delete",
      );
    },
    async flush(): Promise<void> {
      const scoped = getORM();
      await scoped.executeFragment(scoped.sql.fragment`DELETE FROM ${scoped.sql.id(table)}`, "delete");
    },
    async getMany<T>(keys: string[]): Promise<(T | undefined)[]> {
      cacheKeys(keys);
      return Promise.all(keys.map((key) => this.get<T>(key)));
    },
    async setMany<T>(entries: CacheEntry<T>[]): Promise<void> {
      const prepared = prepareCacheEntries(entries);
      for (const entry of prepared) {
        await this.set(entry.key, entry.raw === undefined ? undefined : JSON.parse(entry.raw), entry.ttlMs);
      }
    },
    async deleteMany(keys: string[]): Promise<void> {
      cacheKeys(keys);
      if (!keys.length) return;
      const scoped = getORM();
      await scoped.executeFragment(
        scoped.sql.fragment`
          DELETE FROM ${scoped.sql.id(table)}
          WHERE ${scoped.sql.id("key")} IN (${scoped.sql.join(keys)})
        `,
        "delete",
      );
    },
  };
}

export interface DatabaseSessionStore {
  create(ttlMs?: number): Promise<string>;
  has(sessionId: string): Promise<boolean>;
  load(sessionId: string): Promise<Record<string, unknown>>;
  get<T = unknown>(sessionId: string, key: string): Promise<T | undefined>;
  getAll(sessionId: string): Promise<Record<string, unknown>>;
  /** Atomically updates one key while preserving unrelated concurrent writes. */
  set(sessionId: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
  /** Atomically removes one key while preserving unrelated concurrent writes. */
  unset(sessionId: string, key: string): Promise<void>;
  destroy(sessionId: string): Promise<void>;
  bindUser(sessionId: string, userId: string): Promise<void>;
  purgeExpired(): Promise<number>;
}

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

function expiryISO(ttlMs: number): string {
  return new Date(Date.now() + Math.max(0, ttlMs)).toISOString();
}

function sessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function serializeSessionValue(key: string, value: unknown): string | undefined {
  const encoded = JSON.stringify({ [key]: value });
  if (encoded === undefined) return undefined;
  const object = JSON.parse(encoded) as Record<string, unknown>;
  return Object.hasOwn(object, key) ? JSON.stringify(object[key]) : undefined;
}

/** Apply one bag-key change in SQL so concurrent distinct keys cannot erase each other. */
async function mutateSessionKey(
  orm: ORM,
  table: string,
  sessionId: string,
  key: string,
  serializedValue: string | undefined,
  ttlMs?: number,
): Promise<void> {
  const sql = orm.sql;
  const data = sql.id("data");
  const now = new Date().toISOString();
  const active = sql.fragment`${sql.id("id")} = ${sessionId} AND ${sql.id("expires_at")} > ${now}`;
  let root: SQLFragment;
  let updated: SQLFragment;

  switch (orm.driver.dialect) {
    case "sqlite":
      root = sql.fragment`CASE WHEN json_valid(${data}) AND json_type(${data}) = 'object' THEN ${data} ELSE '{}' END`;
      updated = serializedValue === undefined
        ? sql.fragment`json_remove(${root}, ${`$.${JSON.stringify(key)}`})`
        : sql.fragment`json_set(${root}, ${`$.${JSON.stringify(key)}`}, json(${serializedValue}))`;
      break;
    case "postgres":
      root = sql.fragment`CASE WHEN jsonb_typeof(COALESCE(NULLIF(${data}, '')::jsonb, '{}'::jsonb)) = 'object'
        THEN COALESCE(NULLIF(${data}, '')::jsonb, '{}'::jsonb) ELSE '{}'::jsonb END`;
      updated = serializedValue === undefined
        ? sql.fragment`(${root} - ${key})`
        : sql.fragment`jsonb_set(${root}, ARRAY[${key}]::text[], ${serializedValue}::jsonb, true)`;
      break;
    case "mysql":
      root = sql.fragment`CASE WHEN JSON_VALID(${data})
        THEN CASE WHEN JSON_TYPE(CAST(${data} AS JSON)) = 'OBJECT'
          THEN CAST(${data} AS JSON) ELSE JSON_OBJECT() END
        ELSE JSON_OBJECT() END`;
      updated = serializedValue === undefined
        ? sql.fragment`JSON_REMOVE(${root}, ${`$.${JSON.stringify(key)}`})`
        : sql.fragment`JSON_SET(${root}, ${`$.${JSON.stringify(key)}`}, CAST(${serializedValue} AS JSON))`;
      break;
  }

  if (ttlMs === undefined) {
    await orm.executeFragment(sql.fragment`
      UPDATE ${sql.id(table)} SET ${data} = ${updated}
      WHERE ${active}
    `, "update");
  } else {
    await orm.executeFragment(sql.fragment`
      UPDATE ${sql.id(table)} SET ${data} = ${updated}, ${sql.id("expires_at")} = ${expiryISO(ttlMs)}
      WHERE ${active}
    `, "update");
  }
}

export function createDatabaseSessionStore(
  orm?: ORM,
  options: { readonly tableName?: string } = {},
): DatabaseSessionStore {
  const table = options.tableName ?? "sessions";
  const getORM = () => resolveORM(orm);
  return {
    async create(ttlMs = DEFAULT_SESSION_TTL_MS): Promise<string> {
      const scoped = getORM();
      const id = sessionToken();
      await scoped.executeFragment(scoped.sql.fragment`
        INSERT INTO ${scoped.sql.id(table)}
          (${scoped.sql.id("id")}, ${scoped.sql.id("user_id")}, ${scoped.sql.id("data")}, ${scoped.sql.id("expires_at")})
        VALUES (${id}, ${null}, ${null}, ${expiryISO(ttlMs)})
      `, "insert");
      return id;
    },
    async has(sessionId: string): Promise<boolean> {
      const scoped = getORM();
      const result = await scoped.executeFragment(scoped.sql.fragment`
        SELECT ${scoped.sql.id("id")} FROM ${scoped.sql.id(table)}
        WHERE ${scoped.sql.id("id")} = ${sessionId}
          AND ${scoped.sql.id("expires_at")} > ${new Date().toISOString()}
        LIMIT 1
      `, "select");
      return result.rows.length > 0;
    },
    async load(sessionId: string): Promise<Record<string, unknown>> {
      const scoped = getORM();
      const result = await scoped.executeFragment<Record<string, unknown>>(scoped.sql.fragment`
        SELECT ${scoped.sql.id("data")}, ${scoped.sql.id("expires_at")}
        FROM ${scoped.sql.id(table)}
        WHERE ${scoped.sql.id("id")} = ${sessionId}
        LIMIT 1
      `, "select");
      const row = result.rows[0];
      if (!row || new Date(String(row["expires_at"])).getTime() <= Date.now() || !row["data"]) return {};
      try {
        const value = JSON.parse(String(row["data"]));
        return typeof value === "object" && value !== null && !Array.isArray(value)
          ? value as Record<string, unknown>
          : {};
      } catch {
        return {};
      }
    },
    async get<T>(sessionId: string, key: string): Promise<T | undefined> {
      return (await this.load(sessionId))[key] as T | undefined;
    },
    async getAll(sessionId: string): Promise<Record<string, unknown>> {
      return this.load(sessionId);
    },
    async set(sessionId: string, key: string, value: unknown, ttlMs = DEFAULT_SESSION_TTL_MS): Promise<void> {
      const scoped = getORM();
      // A single-key SQL mutation preserves unrelated concurrent session
      // writes. Read/merge/write here loses keys across Workers or adapters.
      await mutateSessionKey(scoped, table, sessionId, key, serializeSessionValue(key, value), ttlMs);
    },
    async unset(sessionId: string, key: string): Promise<void> {
      const scoped = getORM();
      await mutateSessionKey(scoped, table, sessionId, key, undefined);
    },
    async destroy(sessionId: string): Promise<void> {
      const scoped = getORM();
      await scoped.executeFragment(
        scoped.sql.fragment`DELETE FROM ${scoped.sql.id(table)} WHERE ${scoped.sql.id("id")} = ${sessionId}`,
        "delete",
      );
    },
    async bindUser(sessionId: string, userId: string): Promise<void> {
      const scoped = getORM();
      await scoped.executeFragment(scoped.sql.fragment`
        UPDATE ${scoped.sql.id(table)}
        SET ${scoped.sql.id("user_id")} = ${userId}
        WHERE ${scoped.sql.id("id")} = ${sessionId}
      `, "update");
    },
    async purgeExpired(): Promise<number> {
      const scoped = getORM();
      const result = await scoped.executeFragment(
        scoped.sql.fragment`
          DELETE FROM ${scoped.sql.id(table)}
          WHERE ${scoped.sql.id("expires_at")} <= ${new Date().toISOString()}
        `,
        "delete",
      );
      return result.meta.rowsAffected ?? 0;
    },
  };
}

export function rawStoreQuery(orm: ORM, fragment: SQLFragment) {
  return orm.executeFragment(fragment);
}
