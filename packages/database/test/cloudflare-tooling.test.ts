import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createCloudflareToolingPlatform, createD1ToolingAdapter, type ToolingWrangler } from "../src/tooling/cloudflare.js";
import type { ORMToolingContext } from "../src/config.js";
import { createORM } from "../src/orm.js";
import { MigrationRunner } from "../src/migration/runner.js";

const roots: string[] = [];
async function fixture(target: "local" | "remote" = "local"): Promise<ORMToolingContext> {
  const cwd = await mkdtemp(join(tmpdir(), "cossack-d1-tooling-"));
  roots.push(cwd);
  await writeFile(join(cwd, "wrangler.jsonc"), "{}");
  return { cwd, configPath: join(cwd, "orm.config.ts"), target, environment: "staging", readOnly: true };
}
function mockWrangler(databaseId?: string) {
  const dispose = vi.fn(async () => {});
  const binding = { prepare: () => ({ bind() { return this; }, all: async () => ({ success: true, results: [] }), run: async () => ({ success: true }) }),
    batch: async () => [] };
  const getPlatformProxy = vi.fn<ToolingWrangler["getPlatformProxy"]>(async () => ({ env: { DB: binding }, dispose }));
  const wrangler: ToolingWrangler = {
    experimental_readRawConfig: () => ({ rawConfig: { env: { staging: {} } } }),
    unstable_readConfig: () => ({ name: "fixture-staging", account_id: "selected-account", compatibility_date: "2026-06-06",
      d1_databases: [{ binding: "DB", database_name: "staging-db", ...(databaseId ? { database_id: databaseId } : {}) }] }),
    getPlatformProxy,
  };
  return { wrangler, getPlatformProxy, dispose };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("D1 tooling target selection", () => {
  it("forces local bindings and shares Wrangler's local state directory", async () => {
    const context = await fixture();
    const { wrangler, getPlatformProxy, dispose } = mockWrangler();
    const adapter = await createD1ToolingAdapter(context, { wrangler });
    expect(getPlatformProxy).toHaveBeenCalledWith({ configPath: join(context.cwd, "wrangler.jsonc"),
      environment: "staging", remoteBindings: false, persist: { path: join(context.cwd, ".wrangler/state/v3") } });
    expect(adapter.tooling).toMatchObject({ provider: "d1", target: "local", accountId: "selected-account",
      environment: "staging", databaseName: "staging-db" });
    await adapter.driver.close(); await adapter.driver.close();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("hides the Worker's own Durable Objects and Workflows from the proxy", async () => {
    const context = await fixture();
    const { wrangler, getPlatformProxy } = mockWrangler();
    const external = { name: "REMOTE", class_name: "Remote", script_name: "other-worker" };
    wrangler.experimental_readRawConfig = () => ({ rawConfig: {
      name: "fixture", main: "./src/index.ts", vars: { APP_URL: "http://localhost" },
      durable_objects: { bindings: [{ name: "COSSACK_SSE", class_name: "SseDurableObject" }, external] },
      migrations: [{ tag: "v1", new_sqlite_classes: ["SseDurableObject"] }],
      workflows: [{ name: "flow", binding: "FLOW", class_name: "Flow" }],
      env: { staging: { durable_objects: { bindings: [{ name: "COSSACK_SSE", class_name: "SseDurableObject" }] } } },
    } });
    let configPath = "";
    getPlatformProxy.mockImplementation(async options => {
      configPath = options.configPath;
      expect(dirname(configPath)).toBe(context.cwd);
      expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
        name: "fixture", main: "./src/index.ts", vars: { APP_URL: "http://localhost" },
        durable_objects: { bindings: [external] }, workflows: [], env: { staging: {} },
      });
      expect(options).toMatchObject({ environment: "staging", remoteBindings: false });
      return mockWrangler().wrangler.getPlatformProxy(options);
    });
    const adapter = await createD1ToolingAdapter(context, { wrangler });
    await expect(readFile(configPath)).rejects.toThrow();
    await adapter.driver.close();
  });

  it("starts a generic tooling platform with the selected environment for remote targets", async () => {
    const context = await fixture("remote");
    const { wrangler, getPlatformProxy, dispose } = mockWrangler();
    const platform = await createCloudflareToolingPlatform<{ DB: unknown }>(context, { wrangler });
    expect(getPlatformProxy).toHaveBeenCalledWith({ configPath: join(context.cwd, "wrangler.jsonc"),
      environment: "staging", remoteBindings: true, persist: false });
    expect(platform.env.DB).toBeDefined();
    await platform.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("forces exactly the selected remote D1 binding and removes its temporary config", async () => {
    const context = await fixture("remote");
    const { wrangler, getPlatformProxy } = mockWrangler("11111111-1111-1111-1111-111111111111");
    let configPath = "";
    getPlatformProxy.mockImplementation(async options => {
      configPath = options.configPath;
      const config = JSON.parse(await readFile(configPath, "utf8"));
      expect(config.d1_databases).toEqual([{ binding: "DB", database_name: "staging-db",
        database_id: "11111111-1111-1111-1111-111111111111", remote: true }]);
      expect(config).not.toHaveProperty("vars");
      expect(config.account_id).toBe("selected-account");
      expect(options).toMatchObject({ remoteBindings: true, persist: false });
      expect(options).not.toHaveProperty("environment");
      return mockWrangler().wrangler.getPlatformProxy(options);
    });
    const adapter = await createD1ToolingAdapter(context, { wrangler });
    expect(adapter.tooling?.target).toBe("remote");
    await expect(readFile(configPath)).rejects.toThrow();
    await adapter.driver.close();
  });

  it("rejects unprovisioned remote databases and unknown environments before opening a proxy", async () => {
    const context = await fixture("remote");
    const { wrangler, getPlatformProxy } = mockWrangler();
    await expect(createD1ToolingAdapter(context, { wrangler })).rejects.toThrow("real database_id");
    await expect(createD1ToolingAdapter({ ...context, environment: "typo" }, { wrangler })).rejects.toThrow("not configured");
    expect(getPlatformProxy).not.toHaveBeenCalled();
  });

  it("cleans up a remote configuration when proxy creation fails", async () => {
    const context = await fixture("remote");
    const { wrangler, getPlatformProxy } = mockWrangler("11111111-1111-1111-1111-111111111111");
    getPlatformProxy.mockRejectedValue(new Error("proxy unavailable"));
    await expect(createD1ToolingAdapter(context, { wrangler })).rejects.toThrow("proxy unavailable");
    expect(await readdir(join(context.cwd, ".wrangler/cossack-tooling"))).toEqual([]);
  });

  it("redacts Wrangler configuration excerpts from tooling errors", async () => {
    const context = await fixture();
    const { wrangler, getPlatformProxy } = mockWrangler();
    wrangler.unstable_readConfig = () => { throw new Error('invalid APP_SECRET = sensitive-fixture-value'); };
    await expect(createD1ToolingAdapter(context, { wrangler })).rejects.toThrow('could not validate');
    await expect(createD1ToolingAdapter(context, { wrangler })).rejects.not.toThrow('sensitive-fixture-value');
    expect(getPlatformProxy).not.toHaveBeenCalled();
  });

  it("uses the real local Wrangler D1 simulator and closes its resources", async () => {
    vi.stubEnv("WRANGLER_SEND_METRICS", "false");
    const context = await fixture();
    const require = createRequire(import.meta.url);
    await mkdir(join(context.cwd, "node_modules"));
    await symlink(dirname(require.resolve("wrangler/package.json")), join(context.cwd, "node_modules/wrangler"), "junction");
    await writeFile(join(context.cwd, "package.json"), "{}");
    await writeFile(join(context.cwd, "index.js"), 'export default {fetch(){return new Response("ok")}}');
    await writeFile(join(context.cwd, "wrangler.jsonc"), JSON.stringify({ name: "d1-tooling-fixture",
      main: "./index.js", compatibility_date: "2026-06-06",
      env: { staging: { d1_databases: [{ binding: "DB", database_name: "staging-db" }] } },
    }));
    const adapter = await createD1ToolingAdapter(context);
    try {
      await adapter.driver.execute({ text: "CREATE TABLE example (id integer)", parameters: [] }, "ddl");
      expect((await adapter.driver.introspect!()).entities.map(entity => entity.tableName)).toEqual(["example"]);
      expect(adapter.tooling).toMatchObject({ target: "local", binding: "DB", databaseName: "staging-db" });
      const orm = createORM({ adapter, entities: [] });
      const runner = new MigrationRunner(orm, [{ name: "001_items", operations: { up: [orm.sql.unsafe("CREATE TABLE items (id integer PRIMARY KEY, label text UNIQUE)")], down: [{ kind: "drop-table", tableName: "items" }] },
        up({ schema, orm }) { schema.raw(orm.sql.unsafe("CREATE TABLE items (id integer PRIMARY KEY, label text UNIQUE)")); },
        down({ schema }) { schema.dropTable("items"); },
      }]);
      await orm.run(async () => {
        expect(await runner.plan()).toMatchObject([{ name: "001_items", complete: true, mode: "apply" }]);
        expect((await orm.executeFragment(orm.sql.unsafe('PRAGMA table_info("_cossack_migrations")'), "select")).rows).toEqual([]);
        expect(await runner.applyPlan(await runner.plan())).toEqual(["001_items"]);
        expect(await runner.plan()).toEqual([]);
        expect((await runner.status({ readOnly: true }))[0]?.state).toBe("applied");
        expect(await runner.plan("down")).toMatchObject([{ mode: "revert", statements: [{ risk: "destructive" }] }]);
        const schema = await orm.introspect();
        expect(schema.entities.map(entity => entity.tableName)).toEqual(["example", "items"]);
        expect(schema.entities[1]?.columns.find(column => column.columnName === "label")?.unique).toBe(true);
        expect(await runner.applyPlan(await runner.plan("down"))).toEqual(["001_items"]);
        expect((await orm.introspect()).entities.map(entity => entity.tableName)).toEqual(["example"]);
      });
    } finally { await adapter.driver.close(); }
  }, 30_000);
});
