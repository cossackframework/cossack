import { expect, it } from 'vitest';
import { resolveDeclarationDispatch } from '../src/member-dispatch.js';
const member = (name, kind, extra = {}) => ({ name, kind, static: false, private: false, ...extra });
const facts = (own, bases = []) => ({ className: 'Child', inheritance: { status: 'resolved' }, members: own, inheritedDeclarations: bases });
const base = members => ({ className: 'Base', source: '/base.ts', members });

it('matches JavaScript instance-field precedence over derived prototype methods', () => {
  class Base { action = () => 'base-field'; overridden = 'base'; }
  class Child extends Base { action() { return 'child-method'; } overridden = 'child'; }
  const result = resolveDeclarationDispatch(facts([member('action', 'method'), member('overridden', 'field')], [base([member('action', 'field'), member('overridden', 'field')])]), '/child.ts');
  expect(new Child().action()).toBe('base-field');
  expect(new Child().overridden).toBe('child');
  expect(result.members).toEqual([
    { name: 'action', owner: 'Base', source: '/base.ts', kind: 'field' },
    { name: 'overridden', owner: 'Child', source: '/child.ts', kind: 'field' },
  ]);
});
it('matches prototype overrides and replacement of inherited accessor descriptors', () => {
  class Base { action() { return 'base'; } get value() { return 1; } }
  class Child extends Base { action() { return 'child'; } set value(_) {} }
  const result = resolveDeclarationDispatch(facts([member('action', 'method'), member('value', 'set')], [base([member('action', 'method'), member('value', 'get')])]), '/child.ts');
  expect(new Child().action()).toBe('child');
  expect(new Child().value).toBeUndefined();
  expect(result.members.find(m => m.name === 'value')).toMatchObject({ owner: 'Child', kind: 'accessor', get: false, set: true });
  expect(result.members.find(m => m.name === 'action').owner).toBe('Child');
});
it('combines same-class accessors and excludes static/private members', () => {
  const result = resolveDeclarationDispatch(facts([member('value', 'get'), member('value', 'set'), member('hidden', 'method', { private: true }), member('factory', 'method', { static: true })]), '/child.ts');
  expect(result.members).toEqual([{ name: 'value', owner: 'Child', source: '/child.ts', kind: 'accessor', get: true, set: true }]);
});
it('does not invent precedence for unresolved inheritance or computed keys', () => {
  expect(resolveDeclarationDispatch({ ...facts([]), membersComplete: false }, '/child.ts').status).toBe('unknown');
  expect(resolveDeclarationDispatch({ inheritance: { status: 'unresolved' } }, '/child.ts').status).toBe('unknown');
  expect(resolveDeclarationDispatch(facts([member(null, 'method')]), '/child.ts')).toMatchObject({ status: 'unknown', members: [] });
});
