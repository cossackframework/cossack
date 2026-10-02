import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import type { ORMConfig, ORMToolingContext } from "../config.js";
import { createORM, type ORM } from "../orm.js";
import { MigrationRunner } from "../migration/runner.js";
import { SeederRunner } from "../seeding/runner.js";
import {
  diffSchemas,
  describeOperation,
  reverseSchemaOperations,
} from "../schema/diff.js";
import type { OrmSchema } from "../schema/types.js";
import { generateMigration, generateModels } from "./generate.js";
import { formatError } from "./format-error.js";
import { ConfigurationError, MigrationError, ORMError } from "../errors.js";
import { dialectFor } from "../dialect/dialects.js";
import { renderOperation } from "../schema/ddl.js";
import { runJSONORMCommand } from "./process-json.js";
export { createD1ToolingAdapter, readD1ToolingBindings, type D1ToolingBinding,
  type D1ToolingOptions, type ToolingWrangler } from "./cloudflare.js";

interface Arguments {
  readonly command?: string;
  readonly action?: string;
  readonly rest: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean>;
}

export interface ORMCommandOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly target?: "local" | "remote";
  readonly environment?: string;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
}

const BOOLEAN_FLAGS = new Set(["help", "force", "prune", "allow-destructive", "json", "dry-run", "remote", "local"]);
function parse(argv: readonly string[]): Arguments {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (value === "--") { positionalOnly = true; continue; }
    if (!positionalOnly && value.startsWith("--")) {
      const equal = value.indexOf("=");
      const name = value.slice(2, equal === -1 ? undefined : equal);
      let parsed: string | boolean;
      if (BOOLEAN_FLAGS.has(name)) {
        const inline = equal === -1 ? "true" : value.slice(equal + 1);
        if (!["true", "false"].includes(inline)) throw new ConfigurationError(`--${name} expects true or false.`);
        parsed = inline === "true";
      } else {
        if (flags.has(name)) throw new ConfigurationError(`--${name} must be supplied once.`);
        const next = argv[index + 1];
        if (equal !== -1) parsed = value.slice(equal + 1);
        else if (next && !next.startsWith("-")) { parsed = next; index++; }
        else throw new ConfigurationError(`--${name} requires a value.`);
        if (!parsed) throw new ConfigurationError(`--${name} requires a nonempty value.`);
      }
      flags.set(name, parsed);
    } else positional.push(value);
  }
  return { ...(positional[0] ? { command: positional[0] } : {}),
    ...(positional[1] ? { action: positional[1] } : {}), rest: positional.slice(2), flags };
}
function enabled(args: Arguments, flag: string): boolean { return args.flags.get(flag) === true; }

export async function loadORMConfig(configPath: string): Promise<ORMConfig> {
  const absolute = resolve(configPath);
  const unregister = register();
  let module: { default?: ORMConfig; config?: ORMConfig };
  try {
    module = await import(`${pathToFileURL(absolute).href}?t=${Date.now()}`) as {
      default?: ORMConfig;
      config?: ORMConfig;
    };
  } finally {
    await unregister();
  }
  const config = module.default ?? module.config;
  if (!config) {
    throw new Error(`${configPath} must export an ORM config as default or "config".`);
  }
  return config;
}

export async function createORMFromConfig(config: ORMConfig, context?: ORMToolingContext): Promise<ORM> {
  const selected = context ?? { cwd: process.cwd(), configPath: resolve("orm.config.ts"), target: "local", readOnly: false };
  if (selected.target === "remote" && typeof config.adapter !== "function") {
    throw new ConfigurationError("Remote tooling requires an adapter factory that accepts ORMToolingContext.");
  }
  const adapter = typeof config.adapter === "function"
    ? await config.adapter(selected)
    : config.adapter;
  return createORM({
    adapter,
    entities: config.entities,
    ...(config.namingStrategy === undefined ? {} : { namingStrategy: config.namingStrategy }),
    ...(config.logger === undefined ? {} : { logger: config.logger }),
  });
}

export async function runORMCommand(
  argv: readonly string[], options: ORMCommandOptions = {},
): Promise<number> {
  return requestsJSON(argv) ? runJSONORMCommand(import.meta.url, argv, options)
    : runORMCommandInProcess(argv, options);
}

function requestsJSON(argv: readonly string[]): boolean {
  let requested = false;
  for (const value of argv) {
    if (value === "--") break;
    if (value === "--json" || value === "--json=true") requested = true;
    else if (value === "--json=false") requested = false;
  }
  return requested;
}

/** @internal Entry point for the isolated JSON command process. */
export async function runORMCommandInProcess(
  argv: readonly string[], options: ORMCommandOptions = {},
): Promise<number> {
  const out = options.stdout ?? console.log;
  const error = options.stderr ?? console.error;
  let args: Arguments | undefined;
  let context: ORMToolingContext | undefined;
  let phase: "arguments" | "configuration" | "connection" | "operation" | "cleanup" = "arguments";
  const requestedJSON = requestsJSON(argv);
  const report = (ok: boolean, data: Record<string, unknown> | null, diagnostics: readonly Record<string, unknown>[] = []) => {
    out(JSON.stringify({ schemaVersion: 1, command: args?.command ?? "orm", action: args?.action ?? null,
      ok, data: data || context ? { target: context ?? null, ...(data ?? {}) } : null, diagnostics },
      (_key, value: unknown) => typeof value === "bigint" ? String(value) : value));
  };
  try {
    args = parse(argv);
    const json = enabled(args, "json");
    const print = json ? (_message: string) => {} : out;
    if (!args.command || enabled(args, "help")) {
      if (json) report(true, { help: help() }); else out(help());
      return 0;
    }
    if (!["migration", "schema", "seed"].includes(args.command)) {
      throw new ConfigurationError(`Unknown command "${args.command} ${args.action ?? ""}". Run cossack-orm --help.`);
    }
    const common = ["config", "env", "target", "remote", "local", "json", "dry-run", "help"];
    const actions: Record<string, Record<string, readonly string[]>> = {
      migration: { generate: ["output", "allow-destructive"], snapshot: ["force"],
        squash: ["output", "prune"], up: [], down: [], status: [], check: [], baseline: [], plan: ["direction"] },
      schema: { pull: ["output", "force"], diff: ["allow-destructive"], check: ["allow-destructive"] },
      seed: { list: [], run: ["only"] },
    };
    const specific = actions[args.command]?.[args.action ?? ""];
    if (!specific) throw new ConfigurationError(`Unknown ${args.command} action "${args.action ?? ""}".`);
    const allowsName = args.command === "migration" && ["generate", "squash"].includes(args.action!);
    if (args.rest.length > (allowsName ? 1 : 0)) {
      throw new ConfigurationError(`Unexpected arguments for ${args.command} ${args.action}.`);
    }
    for (const name of args.flags.keys()) if (![...common, ...specific].includes(name)) {
      throw new ConfigurationError(`Unknown ${args.command} ${args.action} option --${name}.`);
    }
    const direction = args.flags.get("direction");
    if (direction !== undefined && direction !== "up" && direction !== "down") {
      throw new ConfigurationError("--direction must be up or down.");
    }
    const targetFlag = args.flags.get("target");
    if (targetFlag !== undefined && targetFlag !== "local" && targetFlag !== "remote") {
      throw new ConfigurationError("--target must be local or remote.");
    }
    if (enabled(args, "local") && enabled(args, "remote")) throw new ConfigurationError("Choose either --local or --remote.");
    const alias = enabled(args, "remote") ? "remote" : enabled(args, "local") ? "local" : undefined;
    if (alias && targetFlag && alias !== targetFlag) throw new ConfigurationError("Database target options conflict.");
    const cwd = resolve(options.cwd ?? process.cwd());
    const configPath = resolve(cwd, options.configPath ?? String(args.flags.get("config") ?? "orm.config.ts"));
    const environment = options.environment ?? args.flags.get("env") ?? process.env.CLOUDFLARE_ENV;
    context = { cwd, configPath, target: options.target ?? alias ?? targetFlag ?? "local",
      ...(typeof environment === "string" && environment ? { environment } : {}),
      readOnly: enabled(args, "dry-run") || ["plan", "status", "check", "diff", "list"].includes(args.action ?? "") };
    phase = "configuration";
    const config = await loadORMConfig(configPath);
    if (args.command === "seed" && args.action === "list") {
      const seeders = SeederRunner.inspect(config.seeds ?? []);
      if (!seeders.length) print("No seeders configured.");
      else for (const seeder of seeders) print(`${seeder.name} (transaction: ${seeder.transaction})`);
      if (json) report(true, { seeders });
      return 0;
    }
    phase = "connection";
    const orm = await createORMFromConfig(config, context);
    let data: Record<string, unknown>;
    try {
      phase = "operation";
      data = await orm.run(async () => {
        if (args!.command === "migration") return migrationCommand(orm, config, args!, cwd, print);
        if (args!.command === "schema") return schemaCommand(orm, args!, cwd, print);
        return seedCommand(orm, config, args!, print);
      });
    } finally {
      const previousPhase = phase;
      phase = "cleanup";
      await orm.close();
      phase = previousPhase;
    }
    // Application factories may return extra connection fields at runtime.
    // Only documented public identity fields enter the machine result.
    const resolvedTarget = orm.tooling ? Object.fromEntries(
      ["provider", "target", "environment", "binding", "databaseName", "databaseId"]
        .filter(key => typeof orm.tooling?.[key as keyof NonNullable<ORM["tooling"]>] === "string")
        .map(key => [key, orm.tooling![key as keyof NonNullable<ORM["tooling"]>]]),
    ) : null;
    if (json) report(true, { dialect: orm.driver.dialect, resolvedTarget, ...data });
    return 0;
  } catch (cause) {
    if (requestedJSON) {
      const name = cause instanceof ORMError ? cause.name : "Error";
      const code = ["ConfigurationError", "MigrationError", "MetadataError", "ScopeError", "QueryError",
        "UnsupportedCapabilityError", "DestructiveSchemaChangeError", "SeederError", "ORMError"].includes(name)
        ? `COSSACK_ORM_${name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}` : "COSSACK_ORM_ERROR";
      report(false, { phase, nextActions: ["Run the same command without --json for detailed diagnostics."] }, [{ code,
        severity: "error", message: `Database tooling failed during ${phase}. Check the configuration and adapter factory; run without --json for diagnostics.` }]);
    } else error(formatError(cause));
    return 1;
  }
}

async function seedCommand(
  orm: ORM,
  config: ORMConfig,
  args: Arguments,
  out: (message: string) => void,
): Promise<Record<string, unknown>> {
  const runner = new SeederRunner(orm, config.seeds ?? []);
  if (args.action !== "run") throw new Error(`Unknown seed action "${args.action ?? ""}".`);
  const onlyFlag = args.flags.get("only");
  if (onlyFlag === true) throw new Error("--only requires a comma-separated seeder name.");
  const only = typeof onlyFlag === "string"
    ? onlyFlag.split(",").map((name) => name.trim()).filter(Boolean)
    : undefined;
  if (enabled(args, "dry-run")) {
    const known = runner.list();
    if (only?.some(name => !known.some(seeder => seeder.name === name))) throw new ConfigurationError("Unknown seeder in --only.");
    const selected = only ? known.filter(seeder => only.includes(seeder.name)) : known;
    out(`Would run: ${selected.map(seeder => seeder.name).join(", ") || "(none)"}. Seeder callbacks were not executed.`);
    return { dryRun: true, complete: false, seeders: selected,
      reason: "Seeder SQL depends on application callbacks and is not executed during a dry run." };
  }
  const results = await runner.run(only === undefined ? {} : { only });
  if (!results.length) {
    out(only === undefined ? "No seeders configured." : "No seeders selected.");
    return { results };
  }
  for (const result of results) {
    const transaction = result.usedTransaction ? "transaction" : "no transaction";
    out(`Seeded ${result.name} (${result.durationMs.toFixed(1)}ms, ${transaction}).`);
  }
  return { results };
}

async function migrationCommand(
  orm: ORM,
  config: ORMConfig,
  args: Arguments,
  cwd: string,
  out: (message: string) => void,
): Promise<Record<string, unknown>> {
  const runner = new MigrationRunner(orm, config.migrations ?? []);
  if (args.action === "plan" || (enabled(args, "dry-run") && ["up", "down"].includes(args.action ?? ""))) {
    const direction = args.flags.get("direction") ?? (args.action === "down" ? "down" : "up");
    if (direction !== "up" && direction !== "down") throw new ConfigurationError("--direction must be up or down.");
    const migrations = await runner.plan(direction);
    for (const migration of migrations) {
      out(`${migration.name}: ${migration.complete ? "planned" : "incomplete"}`);
      for (const statement of migration.statements) out(`[${statement.risk}] ${statement.text}`);
      if (migration.reason) out(migration.reason);
    }
    return { dryRun: true, direction, complete: migrations.every(migration => migration.complete), migrations };
  }
  if (args.action === "up") {
    const names = await runner.up();
    out(names.length ? `Applied: ${names.join(", ")}` : "No pending migrations.");
    return { applied: names };
  } else if (args.action === "down") {
    const names = await runner.down();
    out(names.length ? `Reverted: ${names.join(", ")}` : "No applied migrations.");
    return { reverted: names };
  } else if (args.action === "status") {
    const statuses = await runner.status({ readOnly: true });
    for (const status of statuses) out(`${status.state.padEnd(8)} ${status.migration.name}`);
    return { migrations: statuses.map(({ migration, ...status }) => ({ name: migration.name, ...status })) };
  } else if (args.action === "check") {
    const statuses = await runner.status({ readOnly: true });
    const invalid = statuses.filter(status => status.state !== "applied");
    if (invalid.length) throw new MigrationError(`Migration check failed: ${invalid.map(status => `${status.migration.name} (${status.state})`).join(", ")}.`);
    out("All migrations are applied and checksums match.");
    return { checked: true };
  } else if (args.action === "baseline") {
    const actual = await orm.introspect();
    const diff = diffSchemas(actual, orm.schema(), { allowDestructive: true });
    if (!diff.empty) {
      throw new Error(
        `Cannot baseline: models differ from the database (${diff.operations.map(describeOperation).join(", ")}).`,
      );
    }
    const hash = await schemaHash(orm.schema());
    if (!enabled(args, "dry-run")) await runner.baseline(hash);
    out(`${enabled(args, "dry-run") ? "Would record" : "Recorded"} baseline ${hash}.`);
    return { hash, dryRun: enabled(args, "dry-run") };
  } else if (args.action === "generate") {
    const name = args.rest[0] ??
      `migration_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
    const desired = orm.schema();
    const paths = migrationPaths(config, cwd);
    const previous = await readSchemaSnapshot(paths.snapshot);
    if (!previous) {
      throw new Error(
        `No model schema snapshot found at ${paths.snapshot}. ` +
        `Run "cossack migration snapshot" once for an existing project, ` +
        `or "cossack migration squash <name>" to create a new baseline.`,
      );
    }
    const diff = diffSchemas(previous, desired, {
      allowDestructive: enabled(args, "allow-destructive"),
    });
    if (diff.empty) {
      out("No model changes since the last migration snapshot.");
      return { operations: [], changes: [] };
    }
    const output = resolve(cwd, String(args.flags.get("output") ?? join(paths.directory, `${name}.ts`)));
    if (enabled(args, "dry-run")) return {
      dryRun: true, output, operations: diff.operations, destructive: diff.destructive,
      sql: diff.operations.flatMap(operation => renderOperation(operation, dialectFor(orm.driver.dialect))),
      changes: [output, paths.snapshot, join(paths.directory, "index.ts")],
    };
    await ensureAbsent(output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, generateMigration(name, diff.operations, orm.driver.dialect, {
      downOperations: reverseSchemaOperations(diff.operations, previous),
    }), "utf8");
    if (await registerMigration(paths.directory, output)) {
      out(`Registered ${name} in ${join(paths.directory, "index.ts")}.`);
    } else {
      out(`Register ${output} in the migrations array before applying it.`);
    }
    await writeSchemaSnapshot(paths.snapshot, desired);
    out(`Generated ${output} with ${diff.operations.length} operation(s).`);
    out(`Updated model schema snapshot ${paths.snapshot}.`);
    return { output, operations: diff.operations, destructive: diff.destructive, snapshot: paths.snapshot };
  } else if (args.action === "snapshot") {
    const paths = migrationPaths(config, cwd);
    if (!enabled(args, "force")) await ensureAbsent(paths.snapshot);
    if (!enabled(args, "dry-run")) await writeSchemaSnapshot(paths.snapshot, orm.schema());
    out(`${enabled(args, "dry-run") ? "Would record" : "Recorded"} model schema snapshot ${paths.snapshot}.`);
    return { snapshot: paths.snapshot, dryRun: enabled(args, "dry-run") };
  } else if (args.action === "squash") {
    const name = args.rest[0] ??
      `squashed_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
    const desired = orm.schema();
    const paths = migrationPaths(config, cwd);
    const empty: OrmSchema = {
      version: 1,
      ...(desired.dialect === undefined ? {} : { dialect: desired.dialect }),
      entities: [],
    };
    const diff = diffSchemas(empty, desired, { allowDestructive: true });
    const output = resolve(cwd, String(args.flags.get("output") ?? join(paths.directory, `${name}.ts`)));
    if (enabled(args, "prune")) validatePruneOutput(paths.directory, output);
    if (enabled(args, "dry-run")) return { dryRun: true, output, operations: diff.operations,
      destructive: diff.destructive, replaces: (config.migrations ?? []).map(migration => migration.name),
      prune: enabled(args, "prune"), sql: diff.operations.flatMap(operation => renderOperation(operation, dialectFor(orm.driver.dialect))) };
    await ensureAbsent(output);
    await mkdir(dirname(output), { recursive: true });
    const replaces = (config.migrations ?? []).map((migration) => migration.name);
    await writeFile(output, generateMigration(name, diff.operations, orm.driver.dialect, {
      replaces,
      reversible: false,
    }), "utf8");
    if (enabled(args, "prune")) {
      await pruneMigrations(paths.directory, output);
      out(`Pruned ${replaces.length} replaced migration(s) and rewrote ${join(paths.directory, "index.ts")}.`);
    } else {
      out("Review the squash, then replace the configured migration list or re-run with --prune.");
    }
    await writeSchemaSnapshot(paths.snapshot, desired);
    out(`Generated squashed baseline ${output} with ${diff.operations.length} operation(s).`);
    out(`Updated model schema snapshot ${paths.snapshot}.`);
    return { output, operations: diff.operations, replaces, snapshot: paths.snapshot };
  } else throw new Error(`Unknown migration action "${args.action ?? ""}".`);
}

function migrationPaths(config: ORMConfig, cwd: string): {
  directory: string;
  snapshot: string;
} {
  const directory = resolve(cwd, config.migrationDirectory ?? "migrations");
  const snapshot = resolve(cwd, config.schemaSnapshot ?? join(directory, ".cossack-schema.json"));
  return { directory, snapshot };
}

async function readSchemaSnapshot(path: string): Promise<OrmSchema | undefined> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as { code?: string }).code === "ENOENT") return undefined;
    throw cause;
  }
  const schema = JSON.parse(source, (_key, value: unknown) => {
    if (
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 1 &&
      typeof (value as { $cossackBigInt?: unknown }).$cossackBigInt === "string"
    ) {
      return BigInt((value as { $cossackBigInt: string }).$cossackBigInt);
    }
    return value;
  }) as Partial<OrmSchema>;
  if (schema.version !== 1 || !Array.isArray(schema.entities)) {
    throw new Error(`${path} is not a supported Cossack model schema snapshot.`);
  }
  return schema as OrmSchema;
}

async function writeSchemaSnapshot(path: string, schema: OrmSchema): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const source = JSON.stringify(schema, (_key, value: unknown) =>
    typeof value === "bigint" ? { $cossackBigInt: String(value) } : value, 2);
  await writeFile(path, `${source}\n`, "utf8");
}

async function pruneMigrations(directory: string, output: string): Promise<void> {
  validatePruneOutput(directory, output);
  const outputName = basename(output);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      entry.name === outputName ||
      ["index.ts", "index.js", "index.mts", "index.mjs"].includes(entry.name)
    ) continue;
    if (![".ts", ".js", ".mts", ".mjs"].includes(extname(entry.name))) continue;
    await rm(join(directory, entry.name));
  }
  const importPath = `./${outputName.slice(0, -extname(outputName).length)}`;
  await writeFile(
    join(directory, "index.ts"),
    `import squashed from ${JSON.stringify(importPath)};\n\n` +
      `export const migrations = [squashed] as const;\n`,
    "utf8",
  );
}

function validatePruneOutput(directory: string, output: string): void {
  if (resolve(dirname(output)) !== resolve(directory)) {
    throw new Error("--prune requires the squashed migration output to be inside migrationDirectory.");
  }
  const outputName = basename(output);
  if (["index.ts", "index.js", "index.mts", "index.mjs"].includes(outputName)) {
    throw new Error("--prune cannot use the migration barrel itself as the squash output.");
  }
}

async function registerMigration(directory: string, output: string): Promise<boolean> {
  if (resolve(dirname(output)) !== resolve(directory)) return false;
  const barrel = join(directory, "index.ts");
  let source: string;
  try {
    source = await readFile(barrel, "utf8");
  } catch (cause) {
    if ((cause as { code?: string }).code === "ENOENT") return false;
    throw cause;
  }
  const declaration = /export\s+const\s+migrations\s*=\s*\[([\s\S]*?)\]\s*as const\s*;/;
  const match = declaration.exec(source);
  if (!match) return false;
  const outputName = basename(output);
  const importPath = `./${outputName.slice(0, -extname(outputName).length)}`;
  if (source.includes(JSON.stringify(importPath)) || source.includes(`'${importPath}'`)) return true;
  const baseIdentifier = `migration_${outputName
    .slice(0, -extname(outputName).length)
    .replace(/[^a-zA-Z0-9_$]/g, "_")}`;
  let identifier = baseIdentifier;
  let suffix = 2;
  while (new RegExp(`\\b${identifier}\\b`).test(source)) identifier = `${baseIdentifier}_${suffix++}`;
  const entries = match[1]!.trim();
  const replacement = `export const migrations = [` +
    `${entries}${entries && !entries.endsWith(",") ? "," : ""}` +
    `${entries ? " " : ""}${identifier}] as const;`;
  await writeFile(
    barrel,
    `import ${identifier} from ${JSON.stringify(importPath)};\n${source.replace(declaration, replacement)}`,
    "utf8",
  );
  return true;
}

async function schemaCommand(
  orm: ORM,
  args: Arguments,
  cwd: string,
  out: (message: string) => void,
): Promise<Record<string, unknown>> {
  const actual = await orm.introspect();
  if (args.action === "pull") {
    const output = resolve(cwd, String(args.flags.get("output") ?? "src/entities.generated.ts"));
    if (!enabled(args, "force")) await ensureAbsent(output);
    if (enabled(args, "dry-run")) return { dryRun: true, output, schema: actual };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, generateModels(actual), "utf8");
    out(`Generated ${output}.`);
    return { output, schema: actual };
  }
  const diff = diffSchemas(actual, orm.schema(), {
    allowDestructive: enabled(args, "allow-destructive"),
  });
  if (args.action === "diff") {
    for (const operation of diff.operations) out(describeOperation(operation));
    if (diff.empty) out("No schema differences.");
  } else if (args.action === "check") {
    if (!diff.empty) {
      throw new Error(`Schema drift detected: ${diff.operations.map(describeOperation).join(", ")}.`);
    }
    out("Database schema matches model metadata.");
  } else throw new ConfigurationError(`Unknown schema action "${args.action ?? ""}".`);
  return { operations: diff.operations, destructive: diff.destructive, empty: diff.empty,
    sql: diff.operations.flatMap(operation => renderOperation(operation, dialectFor(orm.driver.dialect))) };
}

async function ensureAbsent(path: string): Promise<void> {
  try {
    await readFile(path);
    throw new Error(`${path} already exists. Choose another output path or use --force where supported.`);
  } catch (cause) {
    if ((cause as { code?: string }).code !== "ENOENT") throw cause;
  }
}

async function schemaHash(schema: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(schema)),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function help(): string {
  return `cossack-orm

  migration generate <name> [--output path] [--allow-destructive]
  migration snapshot [--force]
  migration squash <name> [--output path] [--prune]
  migration up | down | status | check | baseline
  migration plan [--direction up|down]
  schema pull [--output path] [--force]
  schema diff | check [--allow-destructive]
  seed list
  seed run [--only name[,name]]

Options:
  --config orm.config.ts   Configuration file (default: orm.config.ts)
  --env <name>             Selected application/Cloudflare environment
  --target local|remote    Explicit database target (default: local)
  --local | --remote       Target aliases
  --dry-run                Preview without applying database/file changes
  --json                   Emit one versioned structured result`;
}
