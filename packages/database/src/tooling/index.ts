import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import type { ORMConfig } from "../config.js";
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

interface Arguments {
  readonly command?: string;
  readonly action?: string;
  readonly rest: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
}

export interface ORMCommandOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
}

function parse(argv: readonly string[]): Arguments {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (value.startsWith("--")) {
      const [name, inline] = value.slice(2).split("=", 2);
      const next = argv[index + 1];
      if (inline !== undefined) flags.set(name!, inline);
      else if (next && !next.startsWith("-")) {
        flags.set(name!, next);
        index++;
      } else flags.set(name!, true);
    } else positional.push(value);
  }
  return {
    ...(positional[0] === undefined ? {} : { command: positional[0] }),
    ...(positional[1] === undefined ? {} : { action: positional[1] }),
    rest: positional.slice(2),
    flags,
  };
}

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

export async function createORMFromConfig(config: ORMConfig): Promise<ORM> {
  const adapter = typeof config.adapter === "function"
    ? await config.adapter()
    : config.adapter;
  return createORM({
    adapter,
    entities: config.entities,
    ...(config.namingStrategy === undefined ? {} : { namingStrategy: config.namingStrategy }),
    ...(config.logger === undefined ? {} : { logger: config.logger }),
  });
}

export async function runORMCommand(
  argv: readonly string[],
  options: ORMCommandOptions = {},
): Promise<number> {
  const out = options.stdout ?? console.log;
  const error = options.stderr ?? console.error;
  try {
    const args = parse(argv);
    if (!args.command || args.flags.has("help")) {
      out(help());
      return 0;
    }
    if (!["migration", "schema", "seed"].includes(args.command)) {
      throw new Error(
        `Unknown command "${args.command} ${args.action ?? ""}". Run cossack-orm --help.`,
      );
    }
    const cwd = options.cwd ?? process.cwd();
    const configPath = resolve(
      cwd,
      options.configPath ?? String(args.flags.get("config") ?? "orm.config.ts"),
    );
    const config = await loadORMConfig(configPath);
    if (args.command === "seed" && args.action === "list") {
      const seeders = SeederRunner.inspect(config.seeds ?? []);
      if (!seeders.length) out("No seeders configured.");
      else for (const seeder of seeders) out(`${seeder.name} (transaction: ${seeder.transaction})`);
      return 0;
    }
    const orm = await createORMFromConfig(config);
    try {
      await orm.run(async () => {
        if (args.command === "migration") await migrationCommand(orm, config, args, cwd, out);
        else if (args.command === "schema") await schemaCommand(orm, args, cwd, out);
        else if (args.command === "seed") await seedCommand(orm, config, args, out);
        else throw new Error(`Unknown command "${args.command}".`);
      });
    } finally {
      await orm.close();
    }
    return 0;
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

async function seedCommand(
  orm: ORM,
  config: ORMConfig,
  args: Arguments,
  out: (message: string) => void,
): Promise<void> {
  const runner = new SeederRunner(orm, config.seeds ?? []);
  if (args.action !== "run") throw new Error(`Unknown seed action "${args.action ?? ""}".`);
  const onlyFlag = args.flags.get("only");
  if (onlyFlag === true) throw new Error("--only requires a comma-separated seeder name.");
  const only = typeof onlyFlag === "string"
    ? onlyFlag.split(",").map((name) => name.trim()).filter(Boolean)
    : undefined;
  const results = await runner.run(only === undefined ? {} : { only });
  if (!results.length) {
    out(only === undefined ? "No seeders configured." : "No seeders selected.");
    return;
  }
  for (const result of results) {
    const transaction = result.usedTransaction ? "transaction" : "no transaction";
    out(`Seeded ${result.name} (${result.durationMs.toFixed(1)}ms, ${transaction}).`);
  }
}

async function migrationCommand(
  orm: ORM,
  config: ORMConfig,
  args: Arguments,
  cwd: string,
  out: (message: string) => void,
): Promise<void> {
  const runner = new MigrationRunner(orm, config.migrations ?? []);
  if (args.action === "up") {
    const names = await runner.up();
    out(names.length ? `Applied: ${names.join(", ")}` : "No pending migrations.");
  } else if (args.action === "down") {
    const names = await runner.down();
    out(names.length ? `Reverted: ${names.join(", ")}` : "No applied migrations.");
  } else if (args.action === "status") {
    for (const status of await runner.status()) out(`${status.state.padEnd(8)} ${status.migration.name}`);
  } else if (args.action === "check") {
    await runner.check();
    out("All migrations are applied and checksums match.");
  } else if (args.action === "baseline") {
    const actual = await orm.introspect();
    const diff = diffSchemas(actual, orm.schema(), { allowDestructive: true });
    if (!diff.empty) {
      throw new Error(
        `Cannot baseline: models differ from the database (${diff.operations.map(describeOperation).join(", ")}).`,
      );
    }
    const hash = await schemaHash(orm.schema());
    await runner.baseline(hash);
    out(`Recorded baseline ${hash}.`);
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
      allowDestructive: args.flags.has("allow-destructive"),
    });
    if (diff.empty) {
      out("No model changes since the last migration snapshot.");
      return;
    }
    const output = resolve(cwd, String(args.flags.get("output") ?? join(paths.directory, `${name}.ts`)));
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
  } else if (args.action === "snapshot") {
    const paths = migrationPaths(config, cwd);
    if (!args.flags.has("force")) await ensureAbsent(paths.snapshot);
    await writeSchemaSnapshot(paths.snapshot, orm.schema());
    out(`Recorded model schema snapshot ${paths.snapshot}.`);
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
    if (args.flags.has("prune")) validatePruneOutput(paths.directory, output);
    await ensureAbsent(output);
    await mkdir(dirname(output), { recursive: true });
    const replaces = (config.migrations ?? []).map((migration) => migration.name);
    await writeFile(output, generateMigration(name, diff.operations, orm.driver.dialect, {
      replaces,
      reversible: false,
    }), "utf8");
    if (args.flags.has("prune")) {
      await pruneMigrations(paths.directory, output);
      out(`Pruned ${replaces.length} replaced migration(s) and rewrote ${join(paths.directory, "index.ts")}.`);
    } else {
      out("Review the squash, then replace the configured migration list or re-run with --prune.");
    }
    await writeSchemaSnapshot(paths.snapshot, desired);
    out(`Generated squashed baseline ${output} with ${diff.operations.length} operation(s).`);
    out(`Updated model schema snapshot ${paths.snapshot}.`);
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
): Promise<void> {
  const actual = await orm.introspect();
  if (args.action === "pull") {
    const output = resolve(cwd, String(args.flags.get("output") ?? "src/entities.generated.ts"));
    if (!args.flags.has("force")) await ensureAbsent(output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, generateModels(actual), "utf8");
    out(`Generated ${output}.`);
    return;
  }
  const diff = diffSchemas(actual, orm.schema(), {
    allowDestructive: args.flags.has("allow-destructive"),
  });
  if (args.action === "diff") {
    for (const operation of diff.operations) out(describeOperation(operation));
    if (diff.empty) out("No schema differences.");
  } else if (args.action === "check") {
    if (!diff.empty) {
      throw new Error(`Schema drift detected: ${diff.operations.map(describeOperation).join(", ")}.`);
    }
    out("Database schema matches model metadata.");
  } else throw new Error(`Unknown schema action "${args.action ?? ""}".`);
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
  schema pull [--output path] [--force]
  schema diff | check [--allow-destructive]
  seed list
  seed run [--only name[,name]]

Options:
  --config orm.config.ts   Configuration file (default: orm.config.ts)`;
}
