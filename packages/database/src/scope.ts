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

/**
 * The ORM whose scope the caller is in. An application may run several ORMs (one per
 * database) and open one's scope inside another's: the innermost scope wins.
 */
export function currentORM(): ORM | undefined {
  let current: ORM | undefined;
  let innermost = 0;
  for (const orm of registered) {
    // An ORM of another copy of this module may not number its scopes: it counts as outermost.
    const sequence = typeof orm.currentScopeSequence === "function"
      ? orm.currentScopeSequence()
      : (orm.isCurrentScope() ? Number.MIN_VALUE : 0);
    if (sequence > innermost) { innermost = sequence; current = orm; }
  }
  return current?.currentScopedORM();
}
