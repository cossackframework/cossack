import type { StudioDatabase } from '../lib/service.js';

const studioDatabaseSymbol = Symbol.for('@cossackframework/studio/database');

export function setStudioDatabase(database: StudioDatabase | undefined): void {
  (globalThis as any)[studioDatabaseSymbol] = database;
}

export function getStudioDatabase(): StudioDatabase {
  const database = (globalThis as any)[studioDatabaseSymbol] as StudioDatabase | undefined;
  if (!database) throw new Error('Cossack Studio has not been initialized.');
  return database;
}
