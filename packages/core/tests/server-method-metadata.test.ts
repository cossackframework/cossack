import 'reflect-metadata';
import { expect, it } from 'vitest';
import { collectServerMethodMetadata } from '../src/shared/server-method-metadata';

it('retains inherited options when a child owns unrelated server metadata', () => {
    class Base {}
    class Child extends Base {}
    const input = { parse: (value: unknown) => value };
    const base = { inherited: { timeout: 42, channel: 'private', input } };
    const child = { local: { timeout: 100 } };
    Reflect.defineMetadata('cossack:server-methods', base, Base);
    Reflect.defineMetadata('cossack:server-methods', child, Child);
    expect(collectServerMethodMetadata(Child)).toEqual({ ...base, ...child });
    expect(collectServerMethodMetadata(Child).inherited.input).toBe(input);
    expect(Object.keys(base)).toEqual(['inherited']);
    expect(Object.keys(child)).toEqual(['local']);
});
it('uses the nearest declaration and rejects nonconstructors safely', () => {
    class Base {}
    class Child extends Base {}
    Reflect.defineMetadata('cossack:server-methods', { action: { timeout: 1 } }, Base);
    Reflect.defineMetadata('cossack:server-methods', { action: { timeout: 2 } }, Child);
    expect(collectServerMethodMetadata(Child).action.timeout).toBe(2);
    expect(collectServerMethodMetadata(null)).toEqual({});
});
