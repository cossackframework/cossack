import { describe, expect, it } from 'vitest';
import '../src/shared/metadata';

describe('metadata reflection shim', () => {
  it('stores own metadata and inherits metadata through the prototype chain', () => {
    class Parent {}
    class Child extends Parent {}

    Reflect.defineMetadata('own', 'parent', Parent);
    Reflect.defineMetadata('own', 'child', Child);
    Reflect.defineMetadata('inherited', 42, Parent);

    expect(Reflect.getOwnMetadata('own', Parent)).toBe('parent');
    expect(Reflect.getOwnMetadata('own', Child)).toBe('child');
    expect(Reflect.getOwnMetadata('inherited', Child)).toBeUndefined();
    expect(Reflect.getMetadata('inherited', Child)).toBe(42);
    expect(Reflect.hasMetadata('inherited', Child)).toBe(true);
    expect(Reflect.hasOwnMetadata('inherited', Child)).toBe(false);
    expect(Reflect.getOwnMetadataKeys(Child)).toEqual(['own']);
    expect(Reflect.getMetadataKeys(Child)).toEqual(['own', 'inherited']);

    expect(Reflect.deleteMetadata('own', Child)).toBe(true);
    expect(Reflect.getMetadata('own', Child)).toBe('parent');
    expect(Reflect.deleteMetadata('missing', Child)).toBe(false);
  });

  it('keeps property metadata separate and supports metadata decorators', () => {
    const prototype = {};
    const applyMetadata = Reflect.metadata('design:type', String);

    applyMetadata(prototype, 'name');
    Reflect.defineMetadata('design:type', Number, prototype, 'count');

    expect(Reflect.getMetadata('design:type', prototype, 'name')).toBe(String);
    expect(Reflect.getMetadata('design:type', prototype, 'count')).toBe(Number);
    expect(Reflect.getMetadata('design:type', prototype)).toBeUndefined();
  });
});
