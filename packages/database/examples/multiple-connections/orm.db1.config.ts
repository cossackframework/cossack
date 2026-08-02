import { defineConfig } from "../../src/index.js";
import { createDB1Adapter } from "./database.js";
import { db1Migrations } from "./migrations/db1/index.js";
import { User } from "./models/index.js";

export default defineConfig({
  adapter: createDB1Adapter,
  entities: [User],
  migrations: db1Migrations,
});
