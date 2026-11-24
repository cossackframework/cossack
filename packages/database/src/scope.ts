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

const SCOPE_SEQUENCE = Symbol.for("@cossackframework/database/scope-sequence");

/**
 * The number of the next scope to open. Scopes are numbered as they open, so the innermost of
 * several ORMs' scopes can be told. The counter is shared like the registry: two copies of
 * this module counting apart would give an outer and an inner scope the same number.
 */
export function nextScopeSequence(): number {
  const next = (typeof registryHost[SCOPE_SEQUENCE] === "number" ? registryHost[SCOPE_SEQUENCE] as number : 0) + 1;
  registryHost[SCOPE_SEQUENCE] = next;
  return next;
}

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
