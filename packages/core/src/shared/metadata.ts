/**
 * The subset of the legacy metadata reflection proposal Cossack needs.
 *
 * `reflect-metadata` implements the full proposal (including metadata-key
 * enumeration, deletion and decorator application). Cossack only reads,
 * writes and inherits metadata, so shipping the full polyfill added a
 * disproportionate fixed cost to every browser bundle.
 */

export {};

type MetadataKey = unknown;
type PropertyKeyOrUndefined = PropertyKey | undefined;
type MetadataValues = Map<MetadataKey, unknown>;
type TargetMetadata = Map<PropertyKeyOrUndefined, MetadataValues>;

const metadataStore = new WeakMap<object, TargetMetadata>();

function assertTarget(target: object): void {
  if ((typeof target !== 'object' || target === null) && typeof target !== 'function') {
    throw new TypeError('Metadata target must be an object');
  }
}

function ownValues(
  target: object,
  propertyKey: PropertyKeyOrUndefined,
  create: boolean,
): MetadataValues | undefined {
  let targetMetadata = metadataStore.get(target);
  if (!targetMetadata && create) {
    targetMetadata = new Map();
    metadataStore.set(target, targetMetadata);
  }

  let values = targetMetadata?.get(propertyKey);
  if (!values && create) {
    values = new Map();
    targetMetadata!.set(propertyKey, values);
  }
  return values;
}

function defineMetadata(
  metadataKey: MetadataKey,
  metadataValue: unknown,
  target: object,
  propertyKey?: PropertyKey,
): void {
  assertTarget(target);
  ownValues(target, propertyKey, true)!.set(metadataKey, metadataValue);
}

function hasOwnMetadata(
  metadataKey: MetadataKey,
  target: object,
  propertyKey?: PropertyKey,
): boolean {
  assertTarget(target);
  return ownValues(target, propertyKey, false)?.has(metadataKey) ?? false;
}

function getOwnMetadata(
  metadataKey: MetadataKey,
  target: object,
  propertyKey?: PropertyKey,
): unknown {
  assertTarget(target);
  return ownValues(target, propertyKey, false)?.get(metadataKey);
}

function getOwnMetadataKeys(
  target: object,
  propertyKey?: PropertyKey,
): unknown[] {
  assertTarget(target);
  return Array.from(ownValues(target, propertyKey, false)?.keys() ?? []);
}

function getMetadata(
  metadataKey: MetadataKey,
  target: object,
  propertyKey?: PropertyKey,
): unknown {
  assertTarget(target);
  let current: object | null = target;
  while (current !== null) {
    const values = ownValues(current, propertyKey, false);
    if (values?.has(metadataKey)) return values.get(metadataKey);
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function hasMetadata(
  metadataKey: MetadataKey,
  target: object,
  propertyKey?: PropertyKey,
): boolean {
  assertTarget(target);
  let current: object | null = target;
  while (current !== null) {
    if (ownValues(current, propertyKey, false)?.has(metadataKey)) return true;
    current = Object.getPrototypeOf(current);
  }
  return false;
}

function getMetadataKeys(
  target: object,
  propertyKey?: PropertyKey,
): unknown[] {
  assertTarget(target);
  const keys = new Set<unknown>();
  let current: object | null = target;
  while (current !== null) {
    for (const key of ownValues(current, propertyKey, false)?.keys() ?? []) {
      keys.add(key);
    }
    current = Object.getPrototypeOf(current);
  }
  return Array.from(keys);
}

function deleteMetadata(
  metadataKey: MetadataKey,
  target: object,
  propertyKey?: PropertyKey,
): boolean {
  assertTarget(target);
  const targetMetadata = metadataStore.get(target);
  const values = targetMetadata?.get(propertyKey);
  if (!values?.delete(metadataKey)) return false;
  if (values.size === 0) targetMetadata!.delete(propertyKey);
  if (targetMetadata!.size === 0) metadataStore.delete(target);
  return true;
}

function metadata(metadataKey: MetadataKey, metadataValue: unknown) {
  return (target: object, propertyKey?: PropertyKey): void => {
    defineMetadata(metadataKey, metadataValue, target, propertyKey);
  };
}

// Respect a user-provided/full implementation when one is already installed.
Reflect.defineMetadata ??= defineMetadata;
Reflect.hasOwnMetadata ??= hasOwnMetadata;
Reflect.getOwnMetadata ??= getOwnMetadata;
Reflect.getOwnMetadataKeys ??= getOwnMetadataKeys;
Reflect.getMetadata ??= getMetadata;
Reflect.getMetadataKeys ??= getMetadataKeys;
Reflect.hasMetadata ??= hasMetadata;
Reflect.deleteMetadata ??= deleteMetadata;
Reflect.metadata ??= metadata;

declare global {
  namespace Reflect {
    function defineMetadata(
      metadataKey: unknown,
      metadataValue: unknown,
      target: object,
      propertyKey?: PropertyKey,
    ): void;
    function hasOwnMetadata(
      metadataKey: unknown,
      target: object,
      propertyKey?: PropertyKey,
    ): boolean;
    function getOwnMetadata(
      metadataKey: unknown,
      target: object,
      propertyKey?: PropertyKey,
    ): any;
    function getOwnMetadataKeys(
      target: object,
      propertyKey?: PropertyKey,
    ): unknown[];
    function getMetadata(
      metadataKey: unknown,
      target: object,
      propertyKey?: PropertyKey,
    ): any;
    function getMetadataKeys(
      target: object,
      propertyKey?: PropertyKey,
    ): unknown[];
    function hasMetadata(
      metadataKey: unknown,
      target: object,
      propertyKey?: PropertyKey,
    ): boolean;
    function deleteMetadata(
      metadataKey: unknown,
      target: object,
      propertyKey?: PropertyKey,
    ): boolean;
    function metadata(
      metadataKey: unknown,
      metadataValue: unknown,
    ): (target: object, propertyKey?: PropertyKey) => void;
  }
}
