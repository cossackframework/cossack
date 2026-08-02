import { MigrationRunner } from "../../src/index.js";
import { createExampleORM } from "./database.js";
import { migrations } from "./migrations/index.js";

export async function migrateDatabase(): Promise<void> {
  const orm = await createExampleORM();
  try {
    const applied = await orm.run(() => new MigrationRunner(orm, migrations).up());
    console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Migrations are already current.");
  } finally {
    await orm.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrateDatabase();
}
