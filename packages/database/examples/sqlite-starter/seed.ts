import { SeederRunner } from "../../src/index.js";
import { createExampleORM } from "./database.js";
import { seeders } from "./seeders/index.js";

export async function runSeeder(): Promise<void> {
  const orm = await createExampleORM();
  try {
    const results = await new SeederRunner(orm, seeders).run();
    for (const result of results) {
      console.log(
        `Seeded ${result.name} (${result.durationMs.toFixed(1)}ms, ` +
          `${result.usedTransaction ? "transaction" : "no transaction"}).`,
      );
    }
  } finally {
    await orm.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runSeeder();
}
