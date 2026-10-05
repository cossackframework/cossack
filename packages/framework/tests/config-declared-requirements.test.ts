import { expect, expectTypeOf, it, vi } from 'vitest';
import { configVariable, requireConfigVariable, prepareConfigStore, runWithConfig, env } from '../src/config';
import type { ConfigRequirements } from '../src/config-requirements';
const requirements: ConfigRequirements = { variables: {
  PORT: { type: 'number', coerce: true }, ENABLED: { type: 'boolean', coerce: true },
  TOKEN: { type: 'string', secret: true }, OPTIONAL: { type: 'string', required: false },
} };
it('validates every declaration before entering the first factory', () => {
  const factory = vi.fn();
  expect(() => prepareConfigStore({ first: factory }, { PORT: '81', ENABLED: 'true' }, { requirements: { last: requirements }, context: { runtime: 'node', environment: 'staging' } }))
    .toThrow(expect.objectContaining({ code: 'COSSACK_CONFIG_REQUIRED_MISSING', requirementName: 'TOKEN', runtime: 'node', environment: 'staging' }));
  expect(factory).not.toHaveBeenCalled();
});
it('provides typed, coerced values inside factories and downstream scopes', async () => {
  const store = prepareConfigStore({ app: () => {
    const port = requireConfigVariable('PORT', 'number');
    expectTypeOf(port).toEqualTypeOf<number>();
    expectTypeOf(configVariable('OPTIONAL', 'string')).toEqualTypeOf<string | undefined>();
    return { port, enabled: requireConfigVariable('ENABLED', 'boolean') };
  } }, { PORT: '81', ENABLED: '1', TOKEN: 'PRIVATE_SENTINEL' }, { requirements: { app: requirements }, context: { runtime: 'node' } });
  expect(store.config).toEqual({ app: { port: 81, enabled: true } });
  expect(JSON.stringify(store.config)).not.toContain('PRIVATE_SENTINEL');
  await runWithConfig(store, async () => {
    await Promise.resolve();
    expect(configVariable('PORT', 'number')).toBe(81);
    expect(env('PORT')).toBe('81');
    expect(configVariable('OPTIONAL', 'string')).toBeUndefined();
    expect(() => requireConfigVariable('OPTIONAL', 'string')).toThrow(expect.objectContaining({ code: 'COSSACK_CONFIG_REQUIRED_MISSING' }));
    expect(() => configVariable('PORT', 'boolean')).toThrow(expect.objectContaining({ code: 'COSSACK_CONFIG_VARIABLE_TYPE_MISMATCH' }));
    expect(() => configVariable('UNDECLARED', 'string')).toThrow(expect.objectContaining({ code: 'COSSACK_CONFIG_REQUIREMENT_UNDECLARED' }));
  });
  expect(configVariable('PORT', 'number')).toBeUndefined();
});
it('rejects values without echoing them and ignores inactive requirements', () => {
  const factory = vi.fn(() => ({}));
  try { prepareConfigStore({ app: factory }, { PORT: 'PRIVATE_SENTINEL' }, { requirements: { app: { variables: { PORT: { type: 'number', coerce: true } } } } }); throw new Error('expected failure'); }
  catch (error) { expect(String(error)).not.toContain('PRIVATE_SENTINEL'); expect(error).toMatchObject({ requirementName: 'PORT', code: 'COSSACK_CONFIG_VARIABLE_INVALID' }); }
  expect(factory).not.toHaveBeenCalled();
  expect(prepareConfigStore({ app: factory }, {}, { requirements: { app: { bindings: { DB: { kind: 'd1', runtimes: ['cloudflare'] } } } }, context: { runtime: 'node' } }).config).toEqual({ app: {} });
});
it('rejects metadata collection accessors without executing them', () => {
  const getter = vi.fn(() => requirements);
  const collection = Object.defineProperty({}, 'app', { get: getter, enumerable: true });
  expect(() => prepareConfigStore({}, {}, { requirements: collection })).toThrow(expect.objectContaining({ code: 'COSSACK_CONFIG_REQUIREMENTS_INVALID' }));
  expect(getter).not.toHaveBeenCalled();
});
