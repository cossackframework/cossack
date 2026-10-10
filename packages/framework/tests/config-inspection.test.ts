// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectConfigRequirements } from '../src/config-inspection';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function project(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cossack-config-inspection-')); roots.push(root);
  mkdirSync(join(root, 'src/config'), { recursive: true });
  for (const [name, source] of Object.entries(files)) writeFileSync(join(root, 'src/config', name), source);
  return root;
}
it('reads literal TypeScript metadata and local named export aliases', async () => {
  const root = project({ 'app.ts': `import type { ConfigRequirements } from './types';
export const requirements = { variables: { PORT: { type: 'number', required: true, coerce: true, secret: false, runtimes: ['node'] } }, bindings: { DB: { kind: 'd1' } } } as const satisfies ConfigRequirements;
export default () => ({ secret: 'SOURCE_SECRET_SENTINEL' });`,
    'other.ts': `const metadata = { variables: { FLAG: { type: 'boolean' } } }; export { metadata as requirements }; export default () => ({});` });
  const result = await inspectConfigRequirements(root);
  expect(result.factories.map(row => row.status)).toEqual(['declared', 'declared']);
  expect(result.factories[0].requirements?.variables?.PORT.type).toBe('number');
  expect(result.factories[0].requirements?.bindings?.DB.kind).toBe('d1');
  expect(result.factories[1].requirements?.variables?.FLAG.type).toBe('boolean');
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('SOURCE_SECRET_SENTINEL');
});
it.each([
  `export const requirements = (() => { throw new Error('DO_NOT_EVALUATE'); })();`,
  `export const requirements = { ...metadata };`,
  `export const requirements = { [secretName]: {} };`,
  `export const requirements = { get variables() { throw new Error('DO_NOT_EVALUATE'); } };`,
  `const metadata = { variables: {} }; metadata.variables.PORT = {}; export { metadata as requirements };`,
  `export { requirements } from './private';`,
  `export * from './private';`,
  `export let requirements = {};`,
  `export const requirements = {}; class Mutator { static { Object.assign(requirements, { invalid: true }); } }`,
  `export function requirements() { return {}; }`,
  `export const { requirements } = importedMetadata;`,
  `export const { nested: { value: requirements } } = importedMetadata;`,
  `export const [requirements] = importedMetadata;`,
  `export const { other, ...requirements } = importedMetadata;`,
  `export enum requirements { TOKEN }`,
  `export namespace requirements { export const variables = {}; }`,
  `export import requirements = Foo;`,
  `export const requirements = { variables: { PORT: variable('SECRET_VALUE') } };`,
])('reports dynamic metadata as unknown without application evaluation: %s', async source => {
  const result = await inspectConfigRequirements(project({ 'app.ts': source }));
  expect(result.factories[0].status).toBe('unknown');
  expect(result.diagnostics[0].code).toBe('COSSACK_CONFIG_REQUIREMENTS_UNKNOWN');
  expect(JSON.stringify(result)).not.toMatch(/DO_NOT_EVALUATE|SECRET_VALUE|private/);
});
it('redacts invalid metadata values and parser failures', async () => {
  const result = await inspectConfigRequirements(project({
    'invalid.ts': `export const requirements = { variables: { TOKEN: { type: 'SECRET_INVALID_TYPE' } } };`,
    'syntax.ts': `export const requirements = { SECRET_SYNTAX_SENTINEL:`,
  }));
  expect(result.factories.map(row => row.status)).toEqual(['invalid', 'unknown']);
  expect(result.diagnostics[0].code).toBe('COSSACK_CONFIG_REQUIREMENTS_INVALID');
  expect(JSON.stringify(result)).not.toMatch(/SECRET_INVALID_TYPE|SECRET_SYNTAX_SENTINEL/);
});
it('does not infer requirements from factory bodies and matches factory discovery exclusions', async () => {
  const result = await inspectConfigRequirements(project({
    'app.ts': `export default () => { throw new Error('FACTORY_NOT_EVALUATED'); };`,
    'app.test.ts': `export const requirements = dynamic();`,
    'app.spec.ts': `export const requirements = dynamic();`,
    'types.d.ts': `export const requirements: unknown;`,
  }));
  expect(result.factories).toEqual([{ key: 'app', source: 'src/config/app.ts', status: 'none', diagnostics: [] }]);
  expect(await inspectConfigRequirements(project())).toEqual({ factories: [], diagnostics: [] });
  const root = project(); rmSync(join(root, 'src'), { recursive: true });
  expect(await inspectConfigRequirements(root)).toEqual({ factories: [], diagnostics: [] });
});

it('does not mistake property keys or type-only exports for runtime metadata exports', async () => {
  const result = await inspectConfigRequirements(project({
    'alias.ts': 'export const { requirements: anotherName } = importedMetadata;',
    'type.ts': 'export type requirements = string; export declare const value: unknown;',
  }));
  expect(result.factories.map(row => row.status)).toEqual(['none', 'none']);
  expect(result.diagnostics).toEqual([]);
});
