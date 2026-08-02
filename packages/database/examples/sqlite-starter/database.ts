import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createORM } from "../../src/index.js";
import { nodeSQLite } from "../../src/runtime/node.js";
import { entities } from "./models/index.js";

export const DATABASE_FILE = fileURLToPath(
  new URL("./.data/sqlite-starter.db", import.meta.url),
);

export async function createExampleAdapter() {
  await mkdir(dirname(DATABASE_FILE), { recursive: true });
  return nodeSQLite({ filename: DATABASE_FILE });
}

export async function createExampleORM() {
  return createORM({
    adapter: await createExampleAdapter(),
    entities,
  });
}
