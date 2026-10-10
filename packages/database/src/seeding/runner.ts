import { ConfigurationError, SeederError, UnsupportedCapabilityError } from "../errors.js";
import { digestEvidence, serializeEvidence, planTarget, executionPolicy, operationStatements, snapshotOperation } from "../migration/plan.js";
import type { ORM } from "../orm.js";
import type {
  Seeder,
  SeederContext,
  SeederInfo,
  SeederInput,
  SeederResult,
  SeederRunOptions,
  SeederTransaction,
  SeederPlanEntry,
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
  private readonly planned = new WeakMap<object, { definitions: string; output: string; target: string; names: readonly string[]; seeders: readonly SeederInput[] }>();
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

  async plan(options: SeederRunOptions = {}): Promise<readonly SeederPlanEntry[]> {
    const selected = this.select(options.only).map(seeder => ({ ...seeder,
      definition: typeof seeder.definition === "function" ? seeder.definition : { ...seeder.definition,
        ...(seeder.definition.operations ? { operations: seeder.definition.operations.map(operation => snapshotOperation(operation) as import("../sql/fragment.js").SQLFragment) } : {}) },
    }));
    const target = planTarget(this.orm);
    const entries = selected.map(seeder => {
      const declaration = typeof seeder.definition === "function" ? undefined : seeder.definition.operations;
      let reason = declaration === undefined ? "Seeder callbacks are not executed during planning; declare authoritative operations." : undefined;
      if (seeder.transaction === "required" && (!this.orm.driver.capabilities.transactions || !this.orm.driver.transaction)) reason = "This seeder requires unsupported interactive transactions.";
      let statements: SeederPlanEntry["statements"] = [];
      try { statements = operationStatements(declaration ?? [], this.orm); }
      catch { reason = "The declared seeder operations cannot be planned for this provider."; }
      const policy = executionPolicy(this.orm);
      const interactive = seeder.transaction !== "none" && this.orm.driver.capabilities.transactions && !!this.orm.driver.transaction;
      return Object.freeze({ name: seeder.name, transaction: seeder.transaction, direction: "seed" as const, target,
        statements, affectedObjects: Object.freeze([...new Set(statements.flatMap(statement => statement.affectedObjects))]),
        ...policy, atomicity: interactive ? "transaction" as const : "none" as const,
        limitations: Object.freeze([...policy.limitations, ...(!interactive ? ["Seeder statements run individually; failure may leave partial changes."] : [])]),
        complete: reason === undefined, ...(reason ? { reason } : {}) });
    });
    const result = Object.freeze(entries);
    this.planned.set(result, { definitions: await this.definitionChecksum(), output: serializeEvidence(result),
      target: serializeEvidence(target), names: Object.freeze(selected.map(seeder => seeder.name)),
      seeders: selected.map(seeder => typeof seeder.definition === "function" ? seeder.definition : {
        ...seeder.definition, ...(seeder.definition.operations ? { operations: seeder.definition.operations.map(operation => snapshotOperation(operation) as import("../sql/fragment.js").SQLFragment) } : {}),
      }) });
    return result;
  }

  async applyPlan(plan: readonly SeederPlanEntry[]): Promise<readonly SeederResult[]> {
    const evidence = this.planned.get(plan);
    if (!evidence || plan.some(entry => !entry.complete)) throw new ConfigurationError("Cannot apply an incomplete or foreign seeder plan.");
    if (evidence.definitions !== await this.definitionChecksum() || evidence.output !== serializeEvidence(plan) ||
        evidence.target !== serializeEvidence(planTarget(this.orm))) throw new ConfigurationError("Seeder plan is stale. Replan before applying.");
    this.planned.delete(plan);
    return new SeederRunner(this.orm, evidence.seeders).run({ only: evidence.names });
  }

  private definitionChecksum(): Promise<string> {
    return digestEvidence(this.normalized.map(seeder => ({ name: seeder.name, transaction: seeder.transaction,
      declaredName: typeof seeder.definition === "function" ? seeder.definition.name : seeder.definition.name,
      declaredTransaction: typeof seeder.definition === "function" ? "auto" : seeder.definition.transaction,
      operations: typeof seeder.definition === "function" ? undefined : seeder.definition.operations,
      run: typeof seeder.definition === "function" ? Function.prototype.toString.call(seeder.definition)
        : seeder.definition.run ? Function.prototype.toString.call(seeder.definition.run) : null })));
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
        const definition = seeder.definition as Seeder;
        if (definition.operations) {
          for (const operation of definition.operations) {
            signal?.throwIfAborted(); await this.orm.executeFragment(operation, "raw", signal);
          }
        } else {
          if (!definition.run) throw new ConfigurationError(`Seeder "${seeder.name}" has no operations or run callback.`);
          await definition.run(context);
        }
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
