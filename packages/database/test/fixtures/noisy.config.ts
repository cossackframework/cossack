import { spawnSync } from "node:child_process";
import { defineConfig } from "../../src/config.js";
import { MemoryDriver } from "../../src/adapter/memory.js";

console.log("sensitive-fixture-import-log");
console.error("sensitive-fixture-import-error");
process.stdout.write('{"schemaVersion":1,"ok":false,"spoof":"stdout"}\n');
spawnSync(process.execPath, ["--eval", 'process.stdout.write("sensitive-fixture-subprocess-log\\n")'], { stdio: "inherit" });

class NoisyDriver extends MemoryDriver {
  override async close() {
    process.stdout.write("sensitive-fixture-disposal-log\n");
    process.stderr.write("sensitive-fixture-disposal-error\n");
  }
}

export default defineConfig({
  entities: [],
  adapter: context => {
    console.log("sensitive-fixture-adapter-log");
    process.env.COSSACK_JSON_ISOLATION_FIXTURE = "changed-in-command";
    return { driver: new NoisyDriver(), tooling: { provider: "noisy-fixture", target: context.target } };
  },
  migrations: [{ name: "001_noisy", up({ orm, schema }) {
    console.error("sensitive-fixture-plan-log");
    schema.raw(orm.sql.unsafe("CREATE TABLE isolated (id integer)"));
  }, down() {} }],
});
