import type { Adapter } from "./adapter/types.js";
import { applyPendingMigrations } from "./migration/startup.js";
import type { Migration } from "./migration/types.js";
import { createORM, type ORM, type ORMOptions } from "./orm.js";

/** What names a tenant's database: `database` is a file's name or the `{tenant}` of a URL. */
export interface TenantDatabase {
  readonly database: string;
  readonly slug: string;
}

/** A tenant's ORM for one piece of work. Call `release` when the work is done. */
export interface TenantORM {
  readonly orm: ORM;
  release(): Promise<void>;
}

export interface TenantORMsOptions {
  /** Open the adapter of a tenant's database. */
  adapter(tenant: TenantDatabase): Adapter | Promise<Adapter>;
  entities: ORMOptions["entities"];
  /** Applied to a tenant's database when it is first opened. Every database has every migration. */
  migrations: readonly Migration[];
  /**
   * True where a connection belongs to one request (Workers): each `open` makes an ORM and
   * `release` closes it. False (default) keeps one ORM per tenant for the process.
   */
  perRequest?: boolean;
  /** How many tenants stay open in a process. The least recently used one is closed. Default: 32. */
  max?: number;
}

export interface TenantORMs {
  open(tenant: TenantDatabase): Promise<TenantORM>;
  /** Close every ORM that is kept open. */
  close(): Promise<void>;
}

/** A database's name is part of a file path or a URL: letters, digits, `-` and `_` only. */
export const TENANT_DATABASE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** `{tenant}` in a URL replaced by the tenant's database name. */
export function tenantUrl(template: string | undefined, tenant: TenantDatabase, name = "TENANT_DATABASE_URL"): string {
  if (!template || !template.includes("{tenant}")) throw new Error(`${name} is required and must contain {tenant}, such as postgres://user:pass@host/app_{tenant}.`);
  return template.replaceAll("{tenant}", tenant.database);
}

/**
 * One ORM per tenant database. A tenant's migrations are applied the first time its
 * database is opened in the process.
 */
export function createTenantORMs(options: TenantORMsOptions): TenantORMs {
  const max = Math.max(options.max ?? 32, 1);
  const kept = new Map<string, Promise<ORM>>();
  const migrated = new Map<string, Promise<unknown>>();

  const make = async (tenant: TenantDatabase): Promise<ORM> => {
    const orm = createORM({ adapter: await options.adapter(tenant), entities: options.entities });
    try {
      let applied = migrated.get(tenant.database);
      if (!applied) {
        applied = applyPendingMigrations(orm, options.migrations);
        migrated.set(tenant.database, applied);
        // A failed migration is not kept: the next request tries again.
        applied.catch(() => { if (migrated.get(tenant.database) === applied) migrated.delete(tenant.database); });
      }
      await applied;
      return orm;
    } catch (error) {
      await orm.close().catch(() => undefined);
      throw error;
    }
  };

  return {
    async open(tenant) {
      if (!TENANT_DATABASE.test(tenant.database)) throw new Error("A tenant's database name has lowercase letters, digits, - and _ only.");
      if (options.perRequest) {
        const orm = await make(tenant);
        return { orm, release: () => orm.close() };
      }
      let opening = kept.get(tenant.database);
      if (opening) {
        // Most recently used last.
        kept.delete(tenant.database);
        kept.set(tenant.database, opening);
      } else {
        opening = make(tenant);
        kept.set(tenant.database, opening);
        opening.catch(() => { if (kept.get(tenant.database) === opening) kept.delete(tenant.database); });
        if (kept.size > max) {
          const [oldest, closing] = kept.entries().next().value as [string, Promise<ORM>];
          kept.delete(oldest);
          // Requests that hold it finish first.
          setTimeout(() => { void closing.then(orm => orm.close()).catch(() => undefined); }, 60_000);
        }
      }
      return { orm: await opening, release: async () => undefined };
    },
    async close() {
      const open = [...kept.values()];
      kept.clear();
      await Promise.all(open.map(opening => opening.then(orm => orm.close()).catch(() => undefined)));
    },
  };
}
