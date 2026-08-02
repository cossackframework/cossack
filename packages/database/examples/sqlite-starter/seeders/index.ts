import { databaseSeeder } from "./database.seeder.js";

// Configuration order is execution order. Keep dependent seeders after the data
// they rely on.
export const seeders = [databaseSeeder] as const;

export { databaseSeeder };
