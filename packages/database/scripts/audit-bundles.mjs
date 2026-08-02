import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const entry = resolve("dist/index.js");
const visited = new Set();
const forbidden = [
  "node:sqlite",
  "node:async_hooks",
  "better-sqlite3",
  "@libsql/client",
  "mysql2",
  "\"pg\"",
  "'pg'",
];

async function visit(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const source = await readFile(path, "utf8");
  for (const value of forbidden) {
    if (source.includes(value)) {
      throw new Error(`Neutral import graph contains forbidden runtime dependency ${value} in ${path}.`);
    }
  }
  const imports = source.matchAll(/(?:from\s+|^import\s+)["'](\.[^"']+)["']/gm);
  for (const match of imports) {
    await visit(resolve(dirname(path), match[1]));
  }
}

await visit(entry);

const cloudflare = await readFile(resolve("dist/runtime/cloudflare.js"), "utf8");
for (const value of [
  "node:sqlite",
  "node:async_hooks",
  "better-sqlite3",
  "@libsql/client/node",
]) {
  if (cloudflare.includes(value)) {
    throw new Error(`Cloudflare entry contains forbidden runtime dependency ${value}.`);
  }
}
if (!cloudflare.includes("@libsql/client/web")) {
  throw new Error("Cloudflare libSQL adapter must import @libsql/client/web.");
}

console.log(
  `Bundle audit passed (${visited.size} neutral modules; Cloudflare entry is Workers-safe).`,
);
