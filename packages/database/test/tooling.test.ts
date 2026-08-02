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
