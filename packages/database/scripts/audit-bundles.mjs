import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Runtime-neutral entries must not reach any runtime driver or Node-only module.
const neutralForbidden = [
  "node:sqlite",
  "node:async_hooks",
  "better-sqlite3",
  "@tursodatabase/database",
  "@tursodatabase/serverless",
  "mysql2",
  "\"pg\"",
  "'pg'",
];

// Workers entries may load pg/mysql2 (Hyperdrive) and the serverless Turso client.
const workersForbidden = [
  "node:sqlite",
  "node:async_hooks",
  "better-sqlite3",
  "@tursodatabase/database",
];

async function auditGraph(entry, forbidden, label) {
  const visited = new Set();
  const visit = async (path) => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = await readFile(path, "utf8");
    for (const value of forbidden) {
      if (source.includes(value)) {
        throw new Error(`${label} import graph contains forbidden runtime dependency ${value} in ${path}.`);
      }
    }
    const imports = source.matchAll(/(?:from\s+|^import\s+)["'](\.[^"']+)["']/gm);
    for (const match of imports) {
      await visit(resolve(dirname(path), match[1]));
    }
  };
  await visit(resolve(entry));
  return visited;
}

const neutral = new Set();
for (const entry of ["dist/index.js", "dist/adapter/index.js", "dist/cossack/index.js"]) {
  for (const path of await auditGraph(entry, neutralForbidden, `Neutral entry ${entry}`)) neutral.add(path);
}

const workers = new Set();
for (const entry of ["dist/runtime/cloudflare.js", "dist/runtime/cloudflare-turso.js"]) {
  for (const path of await auditGraph(entry, workersForbidden, `Workers entry ${entry}`)) workers.add(path);
}

const cloudflareTurso = await readFile(resolve("dist/runtime/cloudflare-turso.js"), "utf8");
if (!cloudflareTurso.includes("@tursodatabase/serverless")) {
  throw new Error("Cloudflare Turso adapter must import @tursodatabase/serverless.");
}

console.log(
  `Bundle audit passed (${neutral.size} neutral modules from /, /adapter and /cossack; ` +
  `${workers.size} Workers modules from /cloudflare and /cloudflare-turso).`,
);
