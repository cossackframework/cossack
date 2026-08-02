import type { ORM } from "./orm.js";

// Vite may prebundle the root package and a subpath export into separate module
// graphs. A symbol-keyed global registry keeps request scope discovery working
// across those otherwise independent copies of this module.
const ORM_REGISTRY = Symbol.for("@cossackframework/database/orm-registry");
const registryHost = globalThis as typeof globalThis & Record<symbol, unknown>;

function ormRegistry(): Set<ORM> {
  const existing = registryHost[ORM_REGISTRY];
  if (existing instanceof Set) return existing as Set<ORM>;
  const created = new Set<ORM>();
  registryHost[ORM_REGISTRY] = created;
  return created;
}

const registered = ormRegistry();

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
