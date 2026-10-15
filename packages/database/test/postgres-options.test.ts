// node-postgres parses DATE and TIMESTAMP (without time zone) as local time.
// Run in UTC+7 so a local-time parse is off by 7 hours.
const previousTimeZone = process.env.TZ;
process.env.TZ = "Asia/Bangkok";

import { afterAll, describe, expect, it } from "vitest";
import { postgres } from "../src/runtime/node.js";
import { hyperdrivePostgres } from "../src/runtime/cloudflare.js";

afterAll(() => {
  if (previousTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimeZone;
});

type Parser = (value: string) => unknown;
interface TypeSource { getTypeParser(oid: number, format?: string): Parser }

function poolTypes(adapter: Awaited<ReturnType<typeof postgres>>): TypeSource {
  return (adapter.driver as unknown as { client: { options: { types: TypeSource } } }).client.options.types;
}

describe("node-postgres type parsing", () => {
  it("runs in UTC+7", () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-420);
  });

  it("reads DATE and TIMESTAMP values as UTC, not process-local time", async () => {
    const adapter = await postgres("postgres://user:secret@127.0.0.1:1/app");
    try {
      const types = poolTypes(adapter);
      expect((types.getTypeParser(1082, "text")("2026-01-02") as Date).toISOString()).toBe("2026-01-02T00:00:00.000Z");
      expect((types.getTypeParser(1114, "text")("2026-01-02 03:04:05.006") as Date).toISOString()).toBe("2026-01-02T03:04:05.006Z");
      expect((types.getTypeParser(1114, "text")("2026-01-02 03:04:05") as Date).toISOString()).toBe("2026-01-02T03:04:05.000Z");
      // Values outside the plain form keep the node-postgres behaviour.
      expect(types.getTypeParser(1082, "text")("infinity")).toBe(Infinity);
      // Other types are untouched: timestamptz carries its own offset.
      expect((types.getTypeParser(1184, "text")("2026-01-02 10:04:05+07") as Date).toISOString()).toBe("2026-01-02T03:04:05.000Z");
      expect(types.getTypeParser(23, "text")("42")).toBe(42);
    } finally {
      await adapter.driver.close();
    }
  });

  it("keeps caller-supplied type parsers", async () => {
    const custom: TypeSource = { getTypeParser: () => (value: string) => `custom:${value}` };
    const adapter = await postgres({ connectionString: "postgres://user:secret@127.0.0.1:1/app", types: custom });
    try {
      expect(poolTypes(adapter)).toBe(custom);
    } finally {
      await adapter.driver.close();
    }
  });

  it("applies the same parsing to Hyperdrive clients", async () => {
    const adapter = await hyperdrivePostgres({
      connectionString: "postgres://user:secret@127.0.0.1:1/app", host: "127.0.0.1", port: 1, user: "user", password: "secret", database: "app",
    });
    const client = (adapter.driver as unknown as { createClient(): { _types: TypeSource } }).createClient();
    expect((client._types.getTypeParser(1082, "text")("2026-01-02") as Date).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});
