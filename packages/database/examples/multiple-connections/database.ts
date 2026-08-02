import { access, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createORM } from "../../src/index.js";
import { nodeSQLite } from "../../src/runtime/node.js";
import { AuditEvent, User } from "./models/index.js";

const DATA_DIRECTORY = fileURLToPath(new URL("./.data/", import.meta.url));

export const DB1_FILE = fileURLToPath(
  new URL("./.data/db1.sqlite", import.meta.url),
);

export const DB2_FILE = fileURLToPath(
  new URL("./.data/db2.sqlite", import.meta.url),
);

export async function createDB1Adapter() {
  await mkdir(dirname(DB1_FILE), { recursive: true });
  return nodeSQLite({ filename: DB1_FILE });
}

export async function createDB2Adapter() {
  await mkdir(dirname(DB2_FILE), { recursive: true });
  return nodeSQLite({ filename: DB2_FILE });
}

export async function createConnections() {
  const [db1Adapter, db2Adapter] = await Promise.all([
    createDB1Adapter(),
    createDB2Adapter(),
  ]);

  return {
    db1: createORM({
      adapter: db1Adapter,
      entities: [User],
    }),
    db2: createORM({
      adapter: db2Adapter,
      entities: [AuditEvent],
    }),
  } as const;
}

export async function resetConnectionFiles(): Promise<void> {
  await mkdir(DATA_DIRECTORY, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");

  for (const file of [DB1_FILE, DB2_FILE]) {
    try {
      await access(file);
    } catch (cause) {
      if ((cause as { code?: string }).code === "ENOENT") continue;
      throw cause;
    }

    const backup = `${file}.${timestamp}.backup`;
    await rename(file, backup);
    console.log(`Existing database moved to ${backup}`);
  }
}
