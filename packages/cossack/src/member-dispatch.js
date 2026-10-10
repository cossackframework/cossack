/** Declaration precedence, not proof of constructor/decorator/runtime effects. */
export function resolveDeclarationDispatch(facts, source) {
  const scope = 'Declared instance fields and prototype members; runtime property mutations are not evaluated.';
  const unknown = reason => ({ status: 'unknown', scope, reason, members: [] });
  if (facts.inheritance?.status !== 'resolved') return unknown('Base declarations are unresolved.');
  const classes = [
    { className: facts.className, source, members: facts.members, membersComplete: facts.membersComplete },
    ...(facts.inheritedDeclarations ?? []),
  ].reverse();
  if (classes.some(cls => cls.membersComplete === false)) return unknown('Constructor parameter properties require additional resolution.');
  if (classes.some(cls => !Array.isArray(cls.members))) return unknown('Member metadata is unavailable.');
  if (classes.some(cls => cls.members.some(member => !member.static && !member.private && member.name === null))) {
    return unknown('Computed instance member names are unresolved.');
  }
  const prototype = new Map();
  const fields = new Map();
  for (const cls of classes) {
    const own = new Map();
    for (const member of cls.members) {
      if (member.static || member.private) continue;
      const entry = { name: member.name, owner: cls.className, source: cls.source, kind: member.kind };
      if (member.kind === 'field') {
        fields.set(member.name, entry);
      } else if (member.kind === 'get' || member.kind === 'set') {
        const previous = own.get(member.name);
        own.set(member.name, {
          ...entry, kind: 'accessor',
          get: member.kind === 'get' || previous?.kind === 'accessor' && previous.get,
          set: member.kind === 'set' || previous?.kind === 'accessor' && previous.set,
        });
      } else {
        own.set(member.name, entry);
      }
    }
    for (const [name, entry] of own) prototype.set(name, entry);
  }
  // All instance fields shadow every prototype member, regardless of which
  // class supplied the nearest prototype declaration. Derived fields win.
  for (const [name, entry] of fields) prototype.set(name, entry);
  return { status: 'resolved', scope, members: [...prototype.values()] };
}
