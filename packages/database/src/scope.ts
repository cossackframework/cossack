import type { ORM } from "./orm.js";

const registered = new Set<ORM>();

export function registerORM(orm: ORM): void {
  registered.add(orm);
}

export function unregisterORM(orm: ORM): void {
  registered.delete(orm);
}

export function currentORM(): ORM | undefined {
  for (const orm of registered) {
    if (orm.isCurrentScope()) return orm.currentScopedORM();
  }
  return undefined;
}
