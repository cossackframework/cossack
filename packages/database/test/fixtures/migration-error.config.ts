import { defineConfig } from "../../src/config.js";
import { MemoryDriver } from "../../src/adapter/memory.js";

export default defineConfig({
  adapter: {
    driver: new MemoryDriver("postgres", (query) => {
      if (query.text.includes("CREATE EXTENSION")) {
        throw Object.assign(new Error('extension "postgis" is not available'), {
          code: "0A000",
          detail: 'Could not open extension control file "postgis.control".',
          hint: "The extension must first be installed on the system where PostgreSQL is running.",
        });
      }
      return { rows: [] };
    }),
  },
  entities: [],
  migrations: [{
    name: "0000_enable_postgis",
    up({ orm, schema }) {
      schema.raw(orm.sql.fragment`CREATE EXTENSION postgis`);
    },
    down() {},
  }],
});
