const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** Record recipe dependency values separately from the merged application package. */
export function dependencyBaseline(pkg) {
  return Object.fromEntries(SECTIONS.map(section => [section, { ...(pkg[section] ?? {}) }]));
}

/** Three-way dependency merge. A missing owned dependency is an intentional edit. */
export function planDependencyChanges(current, desired, previous = {}, { force = false } = {}) {
  const next = dependencyBaseline(current);
  const baseline = dependencyBaseline(previous);
  const updates = [], additions = [], removals = [], preserved = [], conflicts = [];
  const entries = (source, name) => Object.fromEntries(SECTIONS
    .filter(section => Object.hasOwn(source[section] ?? {}, name))
    .map(section => [section, source[section][name]]));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const names = new Set(SECTIONS.flatMap(section => [
    ...Object.keys(current[section] ?? {}), ...Object.keys(desired[section] ?? {}),
    ...Object.keys(previous[section] ?? {}),
  ]));
  for (const name of [...names].sort()) {
    const actual = entries(current, name), before = entries(previous, name), target = entries(desired, name);
    const owned = Object.keys(before).length > 0;
    const present = Object.keys(actual).length > 0;
    const wanted = Object.keys(target).length > 0;
    const canApply = force && (owned || wanted) || (owned ? equal(actual, before) || equal(actual, target) : !present);
    if (!canApply) {
      const reason = !owned ? 'user-owned' : !present ? 'locally-deleted' : 'locally-modified';
      preserved.push({ name, reason, sections: Object.keys(actual) });
      if ((owned || wanted) && !equal(actual, target)) conflicts.push({ name, reason, resolution: 'preserve' });
      continue;
    }
    for (const section of SECTIONS) {
      const from = actual[section], to = target[section];
      if (to === undefined) { delete next[section][name]; delete baseline[section][name]; }
      else { next[section][name] = to; baseline[section][name] = to; }
      if (from === to) continue;
      if (from === undefined) additions.push({ name, section, to });
      else if (to === undefined) removals.push({ name, section, from });
      else updates.push({ name, section, from, to, changed: true });
    }
  }
  for (const section of SECTIONS) {
    if (!(section in current) && !(section in desired)) { delete next[section]; continue; }
    next[section] = Object.fromEntries([...new Set([
      ...Object.keys(desired[section] ?? {}), ...Object.keys(current[section] ?? {}),
    ])].filter(name => Object.hasOwn(next[section], name)).map(name => [name, next[section][name]]));
  }
  return { next, baseline, updates, additions, removals, preserved, conflicts };
}
