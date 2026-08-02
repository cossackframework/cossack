import type { ORM } from "../orm.js";
import { currentORM } from "../scope.js";
import type { SQLFragment } from "../sql/fragment.js";

export interface MiddlewareContext {
  set?(key: string, value: unknown): void;
}

export type MiddlewareNext = () => Promise<void>;
export type ORMFactory<Context extends MiddlewareContext = MiddlewareContext> =
  (context: Context) => ORM | Promise<ORM>;

/**
 * Scope an ORM to all downstream request work.
 *
 * An ORM instance is caller-owned and is never closed by middleware. An ORM
 * created by a request factory is owned by middleware and is always closed,
 * including when downstream throws.
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
      if (ownsORM) await orm.close();
    }
  };
}

export interface CacheEntry<T = unknown> {
  readonly key: string;
  readonly value: T;
  readonly ttlSeconds?: number;
}

export interface CacheStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
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

function cacheExpiry(ttlSeconds?: number): number | null {
  return ttlSeconds === undefined
    ? null
    : Date.now() + Math.max(0, ttlSeconds) * 1_000;
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
    async get<T>(key: string): Promise<T | undefined> {
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
        await this.delete(key);
        return undefined;
      }
      try {
        return JSON.parse(String(row["value"])) as T;
      } catch {
        await this.delete(key);
        return undefined;
      }
    },
    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
      if (value === undefined) return this.delete(key);
      const scoped = getORM();
      const json = JSON.stringify(value);
      const expiresAt = cacheExpiry(ttlSeconds);
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
      const scoped = getORM();
      const result = await scoped.executeFragment<Record<string, unknown>>(scoped.sql.fragment`
        SELECT ${scoped.sql.id("expires_at")}
        FROM ${scoped.sql.id(table)}
        WHERE ${scoped.sql.id("key")} = ${key}
        LIMIT 1
      `, "select");
      const row = result.rows[0];
      if (!row) return false;
      if (cacheExpired(row["expires_at"])) {
        await this.delete(key);
        return false;
      }
      return true;
    },
    async delete(key: string): Promise<void> {
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
      return Promise.all(keys.map((key) => this.get<T>(key)));
    },
    async setMany<T>(entries: CacheEntry<T>[]): Promise<void> {
      for (const entry of entries) {
        await this.set(entry.key, entry.value, entry.ttlSeconds);
      }
    },
    async deleteMany(keys: string[]): Promise<void> {
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
  load(sessionId: string): Promise<Record<string, unknown>>;
  get<T = unknown>(sessionId: string, key: string): Promise<T | undefined>;
  getAll(sessionId: string): Promise<Record<string, unknown>>;
  set(sessionId: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
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
      const data = await this.load(sessionId);
      data[key] = value;
      const json = JSON.stringify(data);
      const expiresAt = expiryISO(ttlMs);
      const fragment = scoped.driver.dialect === "mysql"
        ? scoped.sql.fragment`
          INSERT INTO ${scoped.sql.id(table)}
            (${scoped.sql.id("id")}, ${scoped.sql.id("user_id")}, ${scoped.sql.id("data")}, ${scoped.sql.id("expires_at")})
          VALUES (${sessionId}, ${null}, ${json}, ${expiresAt})
          ON DUPLICATE KEY UPDATE
            ${scoped.sql.id("data")} = VALUES(${scoped.sql.id("data")}),
            ${scoped.sql.id("expires_at")} = VALUES(${scoped.sql.id("expires_at")})
        `
        : scoped.sql.fragment`
          INSERT INTO ${scoped.sql.id(table)}
            (${scoped.sql.id("id")}, ${scoped.sql.id("user_id")}, ${scoped.sql.id("data")}, ${scoped.sql.id("expires_at")})
          VALUES (${sessionId}, ${null}, ${json}, ${expiresAt})
          ON CONFLICT (${scoped.sql.id("id")}) DO UPDATE SET
            ${scoped.sql.id("data")} = excluded.${scoped.sql.id("data")},
            ${scoped.sql.id("expires_at")} = excluded.${scoped.sql.id("expires_at")}
        `;
      await scoped.executeFragment(fragment, "insert");
    },
    async unset(sessionId: string, key: string): Promise<void> {
      const scoped = getORM();
      const data = await this.load(sessionId);
      if (!(key in data)) return;
      delete data[key];
      await scoped.executeFragment(scoped.sql.fragment`
        UPDATE ${scoped.sql.id(table)}
        SET ${scoped.sql.id("data")} = ${JSON.stringify(data)}
        WHERE ${scoped.sql.id("id")} = ${sessionId}
      `, "update");
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
