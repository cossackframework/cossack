import { access, rename } from "node:fs/promises";
import { constants } from "node:fs";
import { DATABASE_FILE, createExampleORM } from "./database.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function createDatabase(options: { reset?: boolean } = {}): Promise<void> {
  if (await exists(DATABASE_FILE)) {
    if (!options.reset) {
      throw new Error(
        `Database already exists at ${DATABASE_FILE}. ` +
        "Use `pnpm example:sqlite:reset` to move it to a backup and start again.",
      );
    }
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const backup = `${DATABASE_FILE}.${timestamp}.backup`;
    await rename(DATABASE_FILE, backup);
    console.log(`Existing database moved to ${backup}`);
  }

  const orm = await createExampleORM();
  await orm.close();
  console.log(`Created empty SQLite database at ${DATABASE_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await createDatabase({ reset: process.argv.includes("--reset") });
}
