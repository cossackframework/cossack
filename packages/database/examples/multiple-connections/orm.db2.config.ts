import { defineConfig } from "../../src/index.js";
import { createDB2Adapter } from "./database.js";
import { db2Migrations } from "./migrations/db2/index.js";
import { AuditEvent } from "./models/index.js";

export default defineConfig({
  adapter: createDB2Adapter,
  entities: [AuditEvent],
  migrations: db2Migrations,
});
