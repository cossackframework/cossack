import type { Adapter } from "../adapter/types.js";
import { ConfigurationError } from "../errors.js";
import { ORM } from "../orm.js";
import { createSQLTag } from "./tag.js";
import type { SQLClient, SQLOptions } from "./client.js";

export interface NodeSQLConstructor {
  new(options: SQLOptions | Adapter | string | Readonly<Record<string, unknown>>): SQLClient;
}

function isAdapter(value: SQLOptions | Adapter): value is Adapter {
  return "driver" in value;
}

async function resolveAutoAdapter(
  options: string | Readonly<Record<string, unknown>>,
): Promise<Adapter> {
  const url = typeof options === "string" ? options : String(options["url"] ?? "");
  const runtime = globalThis as typeof globalThis & { Bun?: unknown; Deno?: unknown };
  if (runtime.Bun) {
    const module = await import("../runtime/bun.js");
    return module.bun(typeof options === "string" ? options : { ...options, url });
  }
  if (runtime.Deno) {
    throw new ConfigurationError(
      "Deno SQL requires an injected driver. Use deno(driver) from @cossackframework/database/deno.",
    );
  }
  const module = await import("../runtime/node.js");
  if (url.startsWith("postgres:") || url.startsWith("postgresql:")) return module.postgres(options);
  if (url.startsWith("mysql:")) return module.mysql(options);
  if (url.startsWith("libsql:") || url.startsWith("https:")) {
    return module.turso(typeof options === "string" ? { url: options } : options as any);
  }
  return module.nodeSQLite({
    filename: url.startsWith("sqlite:") ? url.slice("sqlite:".length) : (url || ":memory:"),
  });
}

class NodeSQLImplementation {
  constructor(options: SQLOptions | Adapter | string | Readonly<Record<string, unknown>>) {
    const explicit = typeof options === "object" && options !== null && (
      isAdapter(options as SQLOptions | Adapter) || "adapter" in options
    );
    if (explicit) {
      const adapter = isAdapter(options as SQLOptions | Adapter)
        ? options as Adapter
        : (options as SQLOptions).adapter;
      const orm = new ORM({ adapter, entities: [] });
      const tag = createSQLTag((fragment) => orm.executeFragment<unknown>(fragment));
      tag.transaction = (callback) => orm.run(() => orm.transaction(callback));
      tag.reserve = (callback) => orm.run(() => orm.reserve(callback));
      tag.close = () => orm.close();
      Object.defineProperty(tag, "orm", { value: orm, enumerable: true });
      return tag as SQLClient;
    }
    let orm: ORM | undefined;
    const resolved = resolveAutoAdapter(
      options as string | Readonly<Record<string, unknown>>,
    ).then((adapter) => {
      orm = new ORM({ adapter, entities: [] });
      return orm;
    });
    const tag = createSQLTag(async (fragment) => (await resolved).executeFragment<unknown>(fragment));
    tag.transaction = async (callback) => {
      const client = await resolved;
      return client.run(() => client.transaction(callback));
    };
    tag.reserve = async (callback) => {
      const client = await resolved;
      return client.run(() => client.reserve(callback));
    };
    tag.close = async () => (await resolved).close();
    Object.defineProperty(tag, "orm", { get: () => orm, enumerable: true });
    return tag as SQLClient;
  }
}

export const SQL = NodeSQLImplementation as unknown as NodeSQLConstructor;
