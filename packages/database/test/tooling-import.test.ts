import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

it("imports tooling without loader IPC and still loads TypeScript configuration on demand", async () => {
  // Keep the fixture below the package so external dependencies resolve normally.
  const scratch = await mkdtemp(join(packageRoot, ".tooling-import-"));
  try {
    const bundle = join(scratch, "tooling.mjs");
    const bundlerRequire = createRequire(require.resolve("tsx/package.json"));
    const esbuild = await import(pathToFileURL(bundlerRequire.resolve("esbuild")).href);
    await esbuild.build({
      entryPoints: [join(packageRoot, "src/tooling/index.ts")],
      outfile: bundle, bundle: true, platform: "node", format: "esm",
      packages: "external", target: "node22", logLevel: "silent",
    });
    const attempts = join(scratch, "network-attempts");
    const guard = join(scratch, "offline.cjs");
    await writeFile(guard, `const fs = require('node:fs');
const deny = () => { fs.appendFileSync(${JSON.stringify(attempts)}, 'attempt\\n'); throw Error('OFFLINE_TOOLING_IMPORT'); };
globalThis.fetch = deny;
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
for (const name of ['node:http', 'node:https']) { const mod = require(name); mod.request = deny; mod.get = deny; }
const dns = require('node:dns');
for (const key of Object.keys(dns)) if (key === 'lookup' || key.startsWith('resolve')) dns[key] = deny;
for (const key of Object.keys(dns.promises)) if (key === 'lookup' || key.startsWith('resolve')) dns.promises[key] = deny;
require('node:module').syncBuiltinESMExports();
`);
    const env = { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" };
    const guarded = (args: string[]) => execute(process.execPath, ["--require", guard, ...args], {
      cwd: packageRoot, env, timeout: 10_000,
    });
    await assert.rejects(guarded(["--eval", 'fetch("https://example.invalid")']), /OFFLINE_TOOLING_IMPORT/);
    expect(await readFile(attempts, "utf8")).toBe("attempt\n");
    await rm(attempts);
    const inspection = await guarded(["--input-type=module", "--eval", `
const tooling = await import(${JSON.stringify(pathToFileURL(bundle).href)});
for (const name of ['loadORMConfig', 'inspectDatabase', 'createORMFromConfig', 'runORMCommand']) {
  if (typeof tooling[name] !== 'function') throw Error('Missing public tooling export: ' + name);
}
`]);
    expect(inspection.stderr).toBe("");
    // Loader IPC errors can be swallowed. Check the receipt, not only exit code.
    await assert.rejects(readFile(attempts), { code: "ENOENT" });

    const config = join(scratch, "orm.config.ts");
    await writeFile(config, "const marker: string = 'loaded-typescript';\nexport default { marker };\n");
    const loaded = await execute(process.execPath, ["--input-type=module", "--eval", `
const { loadORMConfig } = await import(${JSON.stringify(pathToFileURL(bundle).href)});
const config = await loadORMConfig(${JSON.stringify(config)});
if (config.marker !== 'loaded-typescript') throw Error('TypeScript configuration was not loaded');
`], { cwd: packageRoot, env, timeout: 10_000 });
    expect(loaded.stderr).toBe("");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 20_000);
