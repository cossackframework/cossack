import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import type { ORMConfig } from "../config.js";
import { createORM, type ORM } from "../orm.js";
import { MigrationRunner } from "../migration/runner.js";
import { SeederRunner } from "../seeding/runner.js";
import { diffSchemas, describeOperation } from "../schema/diff.js";
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
    const actual = await orm.introspect();
    const diff = diffSchemas(actual, orm.schema(), {
      allowDestructive: args.flags.has("allow-destructive"),
    });
    const output = resolve(cwd, String(args.flags.get("output") ?? `migrations/${name}.ts`));
    await ensureAbsent(output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, generateMigration(name, diff.operations, orm.driver.dialect), "utf8");
    out(`Generated ${output} with ${diff.operations.length} operation(s).`);
  } else throw new Error(`Unknown migration action "${args.action ?? ""}".`);
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
  migration up | down | status | check | baseline
  schema pull [--output path] [--force]
  schema diff | check [--allow-destructive]
  seed list
  seed run [--only name[,name]]

Options:
  --config orm.config.ts   Configuration file (default: orm.config.ts)`;
}
