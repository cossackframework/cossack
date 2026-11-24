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
  /** An open ORM, how many pieces of work hold it, and whether it left the kept ones. */
  interface Entry { readonly opening: Promise<ORM>; users: number; evicted: boolean }
  const kept = new Map<string, Entry>();
  // ORMs that left the kept ones while work still holds them: a new request for the same
  // database takes the same ORM again, so a database is never open twice.
  const leaving = new Map<string, Entry>();
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

  const close = (entry: Entry) => { void entry.opening.then(orm => orm.close()).catch(() => undefined); };

  return {
    async open(tenant) {
      if (!TENANT_DATABASE.test(tenant.database)) throw new Error("A tenant's database name has lowercase letters, digits, - and _ only.");
      if (options.perRequest) {
        const orm = await make(tenant);
        return { orm, release: () => orm.close() };
      }
      const name = tenant.database;
      let entry = kept.get(name) ?? leaving.get(name);
      if (entry) {
        // Most recently used last.
        kept.delete(name);
        leaving.delete(name);
        entry.evicted = false;
        kept.set(name, entry);
      } else {
        const created: Entry = { opening: make(tenant), users: 0, evicted: false };
        entry = created;
        kept.set(name, created);
        created.opening.catch(() => { if (kept.get(name) === created) kept.delete(name); if (leaving.get(name) === created) leaving.delete(name); });
      }
      const held = entry;
      held.users++;
      if (kept.size > max) {
        // The least recently used one that is not this one leaves. It closes when its work is done.
        for (const [oldest, candidate] of kept) {
          if (candidate === held) continue;
          kept.delete(oldest);
          candidate.evicted = true;
          if (candidate.users === 0) close(candidate);
          else leaving.set(oldest, candidate);
          break;
        }
      }
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        held.users--;
        if (held.evicted && held.users === 0) {
          if (leaving.get(name) === held) leaving.delete(name);
          close(held);
        }
      };
      try { return { orm: await held.opening, release }; }
      catch (error) { await release(); throw error; }
    },
    async close() {
      const open = [...kept.values(), ...leaving.values()];
      kept.clear();
      leaving.clear();
      await Promise.all(open.map(entry => entry.opening.then(orm => orm.close()).catch(() => undefined)));
    },
  };
}
