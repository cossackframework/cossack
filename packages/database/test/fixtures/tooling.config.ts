import { defineConfig } from "../../src/config.js";
import { MemoryDriver } from "../../src/adapter/memory.js";

export default defineConfig({
  adapter: { driver: new MemoryDriver() },
  entities: [],
});
