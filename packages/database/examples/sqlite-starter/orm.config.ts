import { defineConfig } from "../../src/index.js";
import { createExampleAdapter } from "./database.js";
import { migrations } from "./migrations/index.js";
import { entities } from "./models/index.js";
import { seeders } from "./seeders/index.js";

export default defineConfig({
  entities,
  migrations,
  seeds: seeders,
  adapter: createExampleAdapter,
});
