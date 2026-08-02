import { ConfigurationError, SeederError, UnsupportedCapabilityError } from "../errors.js";
import type { ORM } from "../orm.js";
import type {
  Seeder,
  SeederContext,
  SeederInfo,
  SeederInput,
  SeederResult,
  SeederRunOptions,
  SeederTransaction,
} from "./types.js";

interface NormalizedSeeder {
  readonly definition: SeederInput;
  readonly name: string;
  readonly transaction: SeederTransaction;
}

function normalizeSeeder(definition: SeederInput): NormalizedSeeder {
  if (typeof definition === "function") {
    const name = definition.name.trim();
    if (!name) {
      throw new ConfigurationError(
        "Anonymous function seeders are not supported. Use defineSeeder({ name, run }) or a named function.",
      );
    }
    return { definition, name, transaction: "auto" };
  }

  const name = definition.name.trim();
  if (!name) throw new ConfigurationError("Seeder names must not be empty.");
  if (!["auto", "required", "none"].includes(definition.transaction ?? "auto")) {
    throw new ConfigurationError(
      `Seeder "${name}" has invalid transaction policy "${String(definition.transaction)}".`,
    );
  }
  return {
    definition,
    name,
    transaction: definition.transaction ?? "auto",
  };
}

function normalizeSeeders(seeders: readonly SeederInput[]): readonly NormalizedSeeder[] {
  const normalized = Object.freeze(seeders.map(normalizeSeeder));
  const names = new Set<string>();
  for (const seeder of normalized) {
    if (names.has(seeder.name)) {
      throw new ConfigurationError(`Duplicate seeder name "${seeder.name}".`);
    }
    names.add(seeder.name);
  }
  return normalized;
}

export class SeederRunner {
  private readonly normalized: readonly NormalizedSeeder[];

  static inspect(seeders: readonly SeederInput[]): readonly SeederInfo[] {
    return normalizeSeeders(seeders).map(({ name, transaction }) => ({ name, transaction }));
  }

  constructor(
    readonly orm: ORM,
    readonly seeders: readonly SeederInput[],
  ) {
    this.normalized = normalizeSeeders(seeders);
  }

  list(): readonly SeederInfo[] {
    return this.normalized.map(({ name, transaction }) => ({ name, transaction }));
  }

  async run(options: SeederRunOptions = {}): Promise<readonly SeederResult[]> {
    const selected = this.select(options.only);
    return this.orm.run(async () => {
      const results: SeederResult[] = [];
      for (const seeder of selected) {
        options.signal?.throwIfAborted();
        results.push(await this.runOne(seeder, options.signal));
      }
      return results;
    });
  }

  private select(only: readonly string[] | undefined): readonly NormalizedSeeder[] {
    if (only === undefined) return this.normalized;
    const requested = new Set(only.map((name) => name.trim()).filter(Boolean));
    const known = new Set(this.normalized.map((seeder) => seeder.name));
    const missing = [...requested].filter((name) => !known.has(name));
    if (missing.length) {
      throw new ConfigurationError(
        `Unknown seeder${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. ` +
          `Available seeders: ${[...known].join(", ") || "(none)"}.`,
      );
    }
    return this.normalized.filter((seeder) => requested.has(seeder.name));
  }

  private async runOne(
    seeder: NormalizedSeeder,
    signal: AbortSignal | undefined,
  ): Promise<SeederResult> {
    const useTransaction = seeder.transaction !== "none" && this.orm.driver.capabilities.transactions;
    if (seeder.transaction === "required" && !useTransaction) {
      throw new SeederError(
        seeder.name,
        new UnsupportedCapabilityError("interactive transactions", this.orm.driver.dialect),
      );
    }

    const execute = async (): Promise<void> => {
      signal?.throwIfAborted();
      const context: SeederContext = {
        orm: this.orm,
        sql: this.orm.sql,
        ...(signal === undefined ? {} : { signal }),
      };
      if (typeof seeder.definition === "function") {
        await seeder.definition(this.orm);
      } else {
        await (seeder.definition as Seeder).run(context);
      }
    };

    const start = performance.now();
    try {
      if (useTransaction) await this.orm.transaction(execute);
      else await execute();
    } catch (cause) {
      if (cause instanceof SeederError) throw cause;
      throw new SeederError(seeder.name, cause);
    }
    return {
      name: seeder.name,
      transaction: seeder.transaction,
      durationMs: performance.now() - start,
      usedTransaction: useTransaction,
    };
  }
}
