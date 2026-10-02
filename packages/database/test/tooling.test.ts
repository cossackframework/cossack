import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createORMFromConfig,
  loadORMConfig,
  runORMCommand,
} from "../src/tooling/index.js";

describe("ORM tooling API", () => {
  it("isolates imports, adapters, callbacks, disposal and inherited subprocess output from JSON", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const before = process.env.COSSACK_JSON_ISOLATION_FIXTURE;
    expect(await runORMCommand(["migration", "plan", "--json"], {
      configPath: resolve("test/fixtures/noisy.config.ts"),
      stdout: message => stdout.push(message), stderr: message => stderr.push(message),
    })).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0]!)).toMatchObject({ ok: true, command: "migration", action: "plan",
      data: { migrations: [{ name: "001_noisy", complete: true }] } });
    expect(stdout[0]).not.toContain("sensitive-fixture");
    expect(stdout[0]).not.toContain("spoof");
    expect(process.env.COSSACK_JSON_ISOLATION_FIXTURE).toBe(before);
  });

  it("reports premature process termination without forwarding raw diagnostics", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(await runORMCommand(["migration", "plan", "--json"], {
      configPath: resolve("test/fixtures/exit.config.ts"),
      stdout: message => stdout.push(message), stderr: message => stderr.push(message),
    })).toBe(1);
    expect(stdout).toHaveLength(1);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0]!)).toMatchObject({ ok: false,
      diagnostics: [{ code: "COSSACK_ORM_PROCESS_FAILED" }] });
    expect(stdout[0]).not.toContain("sensitive-fixture");
  });
  it("passes the selected target/environment to factories and emits one JSON SQL plan", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(await runORMCommand(["migration", "plan", "--target", "remote", "--env", "staging", "--json"], {
      configPath: resolve("test/fixtures/context.config.ts"),
      stdout: message => stdout.push(message), stderr: message => stderr.push(message),
    })).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0]!)).toMatchObject({ schemaVersion: 1, command: "migration", action: "plan", ok: true,
      data: { target: { environment: "staging", target: "remote", readOnly: true },
        resolvedTarget: { provider: "context-fixture", environment: "staging", target: "remote" },
        complete: true, migrations: [{ name: "001_queued", statements: [{ text: "CREATE TABLE users (id integer primary key)" }] }] } });
  });

  it("dry-runs seeders without executing their callbacks", async () => {
    const stdout: string[] = [];
    expect(await runORMCommand(["seed", "run", "--dry-run", "--json"], {
      configPath: resolve("test/fixtures/context.config.ts"), stdout: message => stdout.push(message),
    })).toBe(0);
    expect(JSON.parse(stdout[0]!)).toMatchObject({ ok: true, data: { dryRun: true, complete: false,
      seeders: [{ name: "fixture" }] } });
  });

  it.each([
    ["--local", "--remote"], ["--target=invalid"], ["--env"], ["--env=a", "--env=b"], ["--typo"],
  ])("reports invalid target options before loading a configuration: %j", async (...flags) => {
    const stdout: string[] = [];
    expect(await runORMCommand(["migration", "status", ...flags, "--json"], {
      configPath: "/does/not/exist.ts", stdout: message => stdout.push(message),
    })).toBe(1);
    expect(JSON.parse(stdout[0]!)).toMatchObject({ ok: false,
      diagnostics: [{ code: "COSSACK_ORM_CONFIGURATION_ERROR", severity: "error" }] });
  });

  it("rejects remote targeting with a static adapter", async () => {
    const stdout: string[] = [];
    expect(await runORMCommand(["migration", "status", "--remote", "--json"], {
      configPath: resolve("test/fixtures/tooling.config.ts"), stdout: message => stdout.push(message),
    })).toBe(1);
    expect(JSON.parse(stdout[0]!).diagnostics[0].message).toContain("adapter factory");
  });

  it("honors the last explicit JSON flag when reporting an error", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(await runORMCommand(["migration", "typo", "--json", "--json=false"], {
      stdout: message => stdout.push(message), stderr: message => stderr.push(message),
    })).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("Unknown migration action");
  });

  it.each([
    ["migration", "up", "--prune"],
    ["migration", "plan", "--direction=sideways"],
    ["migration", "status", "unexpected"],
    ["migration", "generate", "one", "two"],
    ["schema", "diff", "--force"],
    ["seed", "list", "--only=fixture"],
    ["migration", "typo"],
  ])("rejects unused options and arguments before opening an adapter: %j", async (...argv) => {
    const stdout: string[] = [];
    expect(await runORMCommand([...argv, "--json"], {
      configPath: "/does/not/exist.ts", stdout: message => stdout.push(message),
    })).toBe(1);
    expect(JSON.parse(stdout[0]!)).toMatchObject({ ok: false, diagnostics: [{ code: "COSSACK_ORM_CONFIGURATION_ERROR" }] });
    expect(stdout[0]).not.toContain("does/not/exist");
  });

  it("previews snapshot and squash file changes without creating files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cossack-preview-files-"));
    try {
      for (const action of [["snapshot"], ["squash", "baseline"]]) {
        const stdout: string[] = [];
        expect(await runORMCommand(["migration", ...action, "--dry-run", "--json"], {
          cwd, configPath: resolve("test/fixtures/context.config.ts"), stdout: message => stdout.push(message),
        })).toBe(0);
        expect(JSON.parse(stdout[0]!).data.dryRun).toBe(true);
        expect(await readdir(cwd)).toEqual([]);
      }
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("reports the failing migration, SQL, and underlying Postgres diagnostics", async () => {
    const stderr: string[] = [];
    expect(await runORMCommand(["migration", "up"], {
      configPath: resolve("test/fixtures/migration-error.config.ts"),
      stderr: (message) => stderr.push(message),
    })).toBe(1);
    const output = stderr.join("\n");
    expect(output).toContain("Migration 0000_enable_postgis failed");
    expect(output).toContain("SQL: CREATE EXTENSION postgis");
    expect(output).toContain('extension "postgis" is not available');
    expect(output).toContain("Code: 0A000");
    expect(output).toContain('Detail: Could not open extension control file "postgis.control".');
    expect(output).toContain("Hint: The extension must first be installed");
  });

  it("loads config and creates an ORM", async () => {
    const config = await loadORMConfig(resolve("test/fixtures/tooling.config.ts"));
    const orm = await createORMFromConfig(config);
    expect(orm.schema().entities).toEqual([]);
    await orm.close();
  });

  it("returns process-style exit codes and supports output capture", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(await runORMCommand(["--help"], {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    })).toBe(0);
    expect(stdout.join("\n")).toContain("migration generate");
    expect(stdout.join("\n")).toContain("migration snapshot");
    expect(stdout.join("\n")).toContain("migration squash");
    expect(stderr).toEqual([]);

    expect(await runORMCommand(["unknown"], {
      configPath: resolve("test/fixtures/tooling.config.ts"),
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    })).toBe(1);
    expect(stderr.at(-1)).toContain("Unknown command");
  });

  it("generates migrations from model snapshot changes without introspection", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cossack-model-migration-"));
    const configPath = resolve("test/fixtures/orm.config.ts");
    const stdout: string[] = [];
    try {
      expect(await runORMCommand(["migration", "snapshot"], {
        cwd,
        configPath,
        stdout: (message) => stdout.push(message),
      })).toBe(0);
      const snapshotPath = join(cwd, "migrations/.cossack-schema.json");
      const previous = JSON.parse(await readFile(snapshotPath, "utf8"));
      previous.entities[0].columns = previous.entities[0].columns.filter(
        (column: { columnName: string }) => column.columnName !== "name",
      );
      await writeFile(snapshotPath, `${JSON.stringify(previous, null, 2)}\n`, "utf8");
      await writeFile(
        join(cwd, "migrations/index.ts"),
        "export const migrations = [] as const;\n",
        "utf8",
      );

      expect(await runORMCommand(["migration", "generate", "add_name"], {
        cwd,
        configPath,
        stdout: (message) => stdout.push(message),
      })).toBe(0);
      const migration = await readFile(join(cwd, "migrations/add_name.ts"), "utf8");
      expect(migration).toContain("ADD COLUMN");
      expect(migration).toContain("DROP COLUMN");
      expect(await readFile(join(cwd, "migrations/index.ts"), "utf8"))
        .toContain("migration_add_name");
      expect(stdout.join("\n")).toContain("Updated model schema snapshot");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("guards removed decorators and generates a reversible destructive migration", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cossack-model-removal-"));
    const originalConfig = resolve("test/fixtures/orm.config.ts");
    const changedConfig = resolve("test/fixtures/orm-without-name.config.ts");
    const stderr: string[] = [];
    try {
      expect(await runORMCommand(["migration", "snapshot"], {
        cwd,
        configPath: originalConfig,
      })).toBe(0);
      expect(await runORMCommand(["migration", "generate", "remove_name"], {
        cwd,
        configPath: changedConfig,
        stderr: (message) => stderr.push(message),
      })).toBe(1);
      expect(stderr.at(-1)).toContain("--allow-destructive");

      expect(await runORMCommand([
        "migration",
        "generate",
        "remove_name",
        "--allow-destructive",
      ], {
        cwd,
        configPath: changedConfig,
      })).toBe(0);
      const migration = await readFile(join(cwd, "migrations/remove_name.ts"), "utf8");
      expect(migration).toContain("DROP COLUMN");
      expect(migration).toContain("ADD COLUMN");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("squashes model metadata and prunes replaced migration files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cossack-squash-"));
    const configPath = resolve("test/fixtures/orm.config.ts");
    try {
      const directory = join(cwd, "migrations");
      await runORMCommand(["migration", "snapshot"], { cwd, configPath });
      await writeFile(join(directory, "0001_old.ts"), "export default {};\n", "utf8");
      await writeFile(join(directory, "index.ts"), "export const migrations = [];\n", "utf8");

      expect(await runORMCommand(["migration", "squash", "0001_schema", "--prune"], {
        cwd,
        configPath,
      })).toBe(0);
      const files = await readdir(directory);
      expect(files).toContain("0001_schema.ts");
      expect(files).not.toContain("0001_old.ts");
      expect(await readFile(join(directory, "index.ts"), "utf8"))
        .toContain("import squashed from \"./0001_schema\"");
      const squash = await readFile(join(directory, "0001_schema.ts"), "utf8");
      expect(squash).toContain("CREATE TABLE");
      expect(squash).toContain('replaces: ["0001_old"]');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
