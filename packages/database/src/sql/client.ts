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
  new(options: SQLOptions | Adapter): SQLClient;
}

function isAdapter(value: SQLOptions | Adapter): value is Adapter {
  return typeof value === "object" && value !== null && "driver" in value;
}

class SQLImplementation {
  constructor(options: SQLOptions | Adapter) {
    if (typeof options !== "object" || options === null) {
      throw new ConfigurationError(
        "The neutral SQL constructor requires an explicit adapter. Import SQL from @cossackframework/database/node for URL-based Node/Bun adapter selection.",
      );
    }
    const adapter = isAdapter(options) ? options : options.adapter;
    const orm = new ORM({ adapter, entities: [] });
    const tag = createSQLTag((fragment) => orm.executeFragment<unknown>(fragment));
    tag.transaction = (callback) => orm.run(() => orm.transaction(callback));
    tag.reserve = (callback) => orm.run(() => orm.reserve(callback));
    tag.close = () => orm.close();
    Object.defineProperty(tag, "orm", { value: orm, enumerable: true });
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
