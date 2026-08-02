import { createDatabase } from "./create-database.js";
import { migrateDatabase } from "./migrate.js";
import { showResults } from "./query.js";
import { runSeeder } from "./seed.js";

const reset = process.argv.includes("--reset");

console.log("1/4 Creating database...");
await createDatabase({ reset });

console.log("\n2/4 Running migrations...");
await migrateDatabase();

console.log("\n3/4 Running seeder...");
await runSeeder();

console.log("\n4/4 Querying results...");
await showResults();
