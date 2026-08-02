import type { Adapter, Driver, QueryResult } from "../adapter/types.js";
import { ConfigurationError, UnsupportedCapabilityError } from "../errors.js";
import { ORM } from "../orm.js";
import { createSQLTag, type SQLTag } from "./tag.js";

export interface SQLOptions {
  readonly adapter: Adapter;
}

export interface SQLClient extends SQLTag {
  readonly orm?: ORM;
}

export interface SQLConstructor {
  new (
    options: SQLOptions | Adapter | string | Readonly<Record<string, unknown>>,
  ): SQLClient;
}

function isAdapter(value: SQLOptions | Adapter): value is Adapter {
  return "driver" in value;
}

class SQLImplementation {
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

export const SQL = SQLImplementation as unknown as SQLConstructor;

export async function executeOnDriver<Row>(
  driver: Driver,
  text: string,
  parameters: readonly import("../adapter/types.js").DatabaseValue[] = [],
): Promise<QueryResult<Row>> {
  return driver.execute<Row>({ text, parameters }, "raw");
}

export function requireCapability(driver: Driver, capability: keyof Driver["capabilities"]): void {
  if (!driver.capabilities[capability]) {
    throw new UnsupportedCapabilityError(capability, driver.dialect);
  }
}

async function resolveAutoAdapter(
  options: string | Readonly<Record<string, unknown>>,
): Promise<Adapter> {
  const url = typeof options === "string" ? options : String(options["url"] ?? "");
  const runtime = globalThis as typeof globalThis & {
    Bun?: unknown;
    Deno?: unknown;
    WebSocketPair?: unknown;
  };
  if (runtime.WebSocketPair && !runtime.Bun && !runtime.Deno) {
    throw new ConfigurationError(
      "Workers do not guess database URLs. Pass an explicit D1/libSQL/Hyperdrive adapter from @cossackframework/database/cloudflare.",
    );
  }
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
  if (url.startsWith("libsql:") || url.startsWith("https:")) return module.libsql(options);
  return module.nodeSQLite({
    filename: url.startsWith("sqlite:") ? url.slice("sqlite:".length) : (url || ":memory:"),
  });
}
