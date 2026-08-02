import { resolve } from "node:path";
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
    expect(stderr).toEqual([]);

    expect(await runORMCommand(["unknown"], {
      configPath: resolve("test/fixtures/tooling.config.ts"),
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    })).toBe(1);
    expect(stderr.at(-1)).toContain("Unknown command");
  });
});
