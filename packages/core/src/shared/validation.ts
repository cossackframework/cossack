// src/shared/validation.ts

import { resolveStatePath } from './store';

/**
 * Validation rule options for the @Validate decorator
 */
export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  email?: boolean;
  url?: boolean;
  custom?: (value: any) => boolean;
  customAsync?: (value: any, component?: any) => Promise<boolean>;
  /**
   * Coerce the value before running the remaining checks. Intended for
   * `getFormData` / `validateObject`, where every `FormData` value arrives as a
   * string: `coerce: 'number'` turns `"25"` into `25` in the returned `data`.
   *
   * Runs AFTER the `required` / emptiness check, so empty values (`null`,
   * `undefined`, `''`) are never coerced — `""` stays `""` (it does not become
   * `0` / `false`). A coercion that cannot succeed (`Number("abc")` → `NaN`,
   * `new Date("xyz")` → Invalid Date) is a validation failure.
   *
   * - `'number'`  → `Number(value)`; `NaN` fails.
   * - `'boolean'` → `"true"` / `"1"` / `"on"` / `"yes"` (case-insensitive) →
   *   `true`, anything else → `false`. Matches checkbox/form values and avoids
   *   `Boolean("false") === true`.
   * - `'date'`    → `new Date(value)`; `Invalid Date` fails.
   *
   * On the reactive `@Validate` path the coerced value is used for validation
   * (more correct) but is NOT written back to the store.
   */
  coerce?: 'number' | 'boolean' | 'date';
  message?: string;
}

// ============================================================================
// Type-safe store rules (nested)
// ============================================================================
// `storeRules<T>()` lets you write validation rules for a @Store property as a
// NESTED tree that mirrors the store type T — so the rules shape matches the
// field shape, and matches the `errors` shape returned from validation.
//
//   @Store()
//   @Validate({
//     rules: storeRules<SubmissionState>({
//       email: { required: true, email: true, message: '...' },
//       address: {
//         zip: { required: true, pattern: /^\d{5}$/ },
//       },
//       tags: { required: true, minLength: 1 },
//     }),
//   })
//   submission: SubmissionState = { email: '', address: { zip: '' }, tags: [] };
//
// Object fields nest a sub-tree; primitive, array, and built-in (Date/RegExp)
// fields take a `ValidationRule` directly. Keys are RELATIVE to the store and
// are auto-prefixed by @Validate to the full runtime paths
// ('submission.email', 'submission.address.zip'). Passing <T> is optional —
// omit it for an untyped map (no compile-time path checking).

/**
 * Built-in non-plain object types that should NOT be recursed into when
 * deriving validation paths (their own methods/properties are not user state).
 * Such values are validated as a whole (e.g. via a `custom` rule).
 */
type NonRecurableObject =
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | Promise<unknown>
  | File
  | Blob
  | ArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/**
 * Recursively build the union of dotted paths into a plain-object type T.
 *
 * - For an object T, yields each string key plus, for keys whose value is
 *   itself a plain object, `'key' + '.' + DeepKeysOf<value>`.
 * - For array values, yields only the top-level key (arrays are validated as a
 *   whole via minLength/maxLength; elements are not addressable).
 * - For built-in non-plain objects (Date, RegExp, Map, Set, typed arrays,
 *   etc.), yields only the top-level key — they are validated as a whole.
 * - For primitives, yields the key only (no recursion).
 * - Yields `never` for non-object types so the recursion terminates.
 */
export type DeepKeysOf<T> = T extends object
  ? T extends (infer _U)[]
    ? never // array elements are not addressable; use the array key directly
    : T extends NonRecurableObject
      ? never // built-in non-plain objects are validated as a whole
      : {
          [K in keyof T & string]: T[K] extends object
            ? T[K] extends (infer _U)[]
              ? K // array value: validate the array as a whole
              : T[K] extends NonRecurableObject
                ? K // built-in non-plain object value: validate as a whole
                : K | `${K}.${DeepKeysOf<T[K]>}`
            : K;
        }[keyof T & string]
  : never;

/**
 * The validation-rules shape for a single field of type `T`.
 *
 * - Primitive leaves (`string`, `number`, …), arrays (`string[]`), and
 *   built-in non-plain objects (`Date`, `RegExp`, `Map`, …) take a
 *   {@link ValidationRule} directly — they are validated as a whole.
 * - Plain object fields nest a sub-tree: each own key takes a
 *   `StoreRuleNode<value>`, so the rules tree mirrors the field shape at any
 *   depth.
 *
 * This is the per-field counterpart of {@link StoreRuleMap}; it lets the rules
 * you write match the structure of `T` (and of the `errors` output).
 */
export type StoreRuleNode<T> = T extends object
  ? T extends (infer _U)[]
    ? ValidationRule // array: validate the whole array (minLength/maxLength/required)
    : T extends NonRecurableObject
      ? ValidationRule // built-in non-plain object: validate as a whole
      : { [K in keyof T]?: StoreRuleNode<T[K]> } // plain object: recurse per key
  : ValidationRule; // primitive: a ValidationRule

/**
 * A nested rule tree that mirrors the store type `T`. Each top-level key is a
 * field of `T`; object fields recurse (per {@link StoreRuleNode}), while
 * primitive/array/built-in fields take a {@link ValidationRule}. At runtime
 * the tree is flattened to dot-path keys (`'address.zip'`) before validation,
 * so the output (`errors`, `flatErrors`) is unchanged.
 */
export type StoreRuleMap<T = any> = { [K in keyof T]?: StoreRuleNode<T[K]> };

/**
 * Identity helper that type-checks a NESTED rule tree against the store type
 * `T`. Returns the tree unchanged at runtime; the type parameter is purely for
 * compile-time validation of the field shape.
 *
 * The tree mirrors `T`: object fields nest a sub-tree, while primitive, array,
 * and built-in (Date/RegExp/…) fields take a {@link ValidationRule} directly.
 * The `@Validate` decorator flattens the tree to the full runtime dot-paths
 * (`'submission.email'`, `'submission.address.zip'`).
 *
 * Omit `<T>` for an untyped map (no compile-time path checking, but still
 * usable with @Validate on a @Store).
 *
 * @example
 * ```ts
 * interface Form { email: string; address: { zip: string }; tags: string[] }
 *
 * @Store()
 * @Validate({ rules: storeRules<Form>({
 *   email: { required: true, email: true },
 *   address: { zip: { required: true, pattern: /^\d{5}$/ } },
 *   tags: { required: true, minLength: 1 },
 * }) })
 * form: Form = { email: '', address: { zip: '' }, tags: [] };
 * ```
 */
export function storeRules<T = any>(
    rules: StoreRuleMap<T>,
): StoreRuleMap<T> {
    return rules;
}

/**
 * Test whether a node is a LEAF {@link ValidationRule} (rather than a nested
 * rule group). Mirrors the value-shape heuristic used by the `@Validate`
 * decorator's `isValidationRuleMap`: a leaf rule never carries a plain-object
 * value — its `pattern` is a `RegExp`, its `custom`/`customAsync` are functions,
 * and the rest are primitives. A nested group (the rules for an object field)
 * has at least one plain-object value: a child rule node.
 *
 * Discriminating by value (not key name) is robust against field names that
 * collide with rule keys (e.g. a field literally named `required`).
 */
function isLeafRule(value: unknown): boolean {
  if (value == null || typeof value !== 'object' || value instanceof RegExp) {
    // A primitive, null, a RegExp, or a function is not a nested group. (A bare
    // rule never appears here in well-typed usage; treating it as leaf-like is
    // safe — it won't be recursed into.)
    return true;
  }
  // A plain object (or array) is a LEAF rule when none of its values is itself
  // a plain object; it is a GROUP when at least one value is a plain object
  // (a child rule node). An empty object is treated as a leaf (a no-op rule).
  return !Object.values(value).some(
    v => v != null && typeof v === 'object' && !(v instanceof RegExp),
  );
}

/**
 * Flatten a nested {@link StoreRuleMap} tree into a flat `Record<dotPath,
 * ValidationRule>` — the shape consumed by `validateObject` and the runtime
 * metadata store. `prefix` is prepended to every emitted path (used by the
 * `@Validate` decorator to prefix relative keys with the store property name).
 *
 * Leaf-vs-group discrimination is value-based via {@link isLeafRule}, so an
 * object field whose children are all rules is still recursed correctly.
 *
 * @example
 *   flattenRuleTree({ address: { zip: { required: true } } }, 'form')
 *   // => { 'form.address.zip': { required: true } }
 */
export function flattenRuleTree(
  node: unknown,
  prefix: string,
  out: Record<string, ValidationRule> = {},
): Record<string, ValidationRule> {
  if (node == null || typeof node !== 'object' || node instanceof RegExp) {
    // Not a tree node (a primitive, null, a RegExp, or a bare rule). A bare
    // rule at the root has no key to flatten under — ignore it.
    return out;
  }
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    if (child == null) continue; // optional slot left empty
    const path = prefix ? `${prefix}.${key}` : key;
    if (isLeafRule(child)) {
      // Leaf: emit as a ValidationRule (RegExp values inside are preserved).
      out[path] = child as ValidationRule;
    } else {
      // Group: recurse into the sub-tree.
      flattenRuleTree(child, path, out);
    }
  }
  return out;
}


/**
 * Configuration options for validation behavior
 */
export interface ValidationConfig {
  trigger?: 'input' | 'blur' | 'submit' | 'all';
  runOn?: 'client' | 'server' | 'both';
  errorProperty?: string;
  debounce?: number;
}

/**
 * Combined validation options
 */
export interface ValidateOptions {
  rules?: ValidationRule;
  config?: ValidationConfig;
}

/**
 * Result of a validation check.
 *
 * `value` is the value that was validated — the coerced value when a `coerce`
 * rule applied, otherwise the original input. Used by `validateObject` to write
 * coerced values back into the returned `data`.
 */
export interface ValidationResult {
  valid: boolean;
  message?: string;
  value?: any;
}

/**
 * Nesting of error messages that mirrors the validated type `T`: each object
 * key becomes an object with `NestedErrors` children, each scalar leaf becomes
 * `string | undefined`. So for `{ address: { city: string } }`, the error type
 * is `{ address?: { city?: string | undefined } }` — usable with optional
 * chaining and destructuring (`errors?.address?.city`).
 *
 * Under the nested `storeRules<T>()` API, an object field always nests a
 * sub-tree (it cannot also carry a direct rule for itself), so an object node
 * is never itself a `string` — only primitive, array, and built-in leaves are.
 */
export type NestedErrors<T> = T extends object
  ? T extends (infer _U)[]
    ? string | undefined
    : T extends NonRecurableObject
      ? string | undefined
      : {
          [K in keyof T]?: NestedErrors<T[K]>;
        }
  : string | undefined;

/**
 * Store for validation rules per property
 */
export interface ValidationRulesStore {
  [propertyName: string]: {
    rules: ValidationRule;
    config: ValidationConfig;
  };
}

/**
 * Email regex pattern
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * URL regex pattern
 */
const URL_REGEX = /^https?:\/\/.+/;

/**
 * Built-in validators
 */
const validators = {
  required: (value: any): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  },

  minLength: (value: any, minLength: number): boolean => {
    if (typeof value === 'string') return value.length >= minLength;
    if (Array.isArray(value)) return value.length >= minLength;
    return false;
  },

  maxLength: (value: any, maxLength: number): boolean => {
    if (typeof value === 'string') return value.length <= maxLength;
    if (Array.isArray(value)) return value.length <= maxLength;
    return false;
  },

  min: (value: any, min: number): boolean => {
    const num = Number(value);
    return !isNaN(num) && num >= min;
  },

  max: (value: any, max: number): boolean => {
    const num = Number(value);
    return !isNaN(num) && num <= max;
  },

  pattern: (value: any, pattern: RegExp): boolean => {
    if (typeof value !== 'string') return false;
    return pattern.test(value);
  },

  email: (value: any): boolean => {
    if (typeof value !== 'string') return false;
    return EMAIL_REGEX.test(value);
  },

  url: (value: any): boolean => {
    if (typeof value !== 'string') return false;
    return URL_REGEX.test(value);
  },
};

/**
 * Get default error message for a validation rule
 */
function getDefaultMessage(rule: ValidationRule, ruleName: string): string {
  switch (ruleName) {
    case 'required':
      return 'This field is required';
    case 'minLength':
      return `Minimum length is ${rule.minLength} characters`;
    case 'maxLength':
      return `Maximum length is ${rule.maxLength} characters`;
    case 'min':
      return `Minimum value is ${rule.min}`;
    case 'max':
      return `Maximum value is ${rule.max}`;
    case 'pattern':
      return 'Invalid format';
    case 'email':
      return 'Please enter a valid email address';
    case 'url':
      return 'Please enter a valid URL';
    case 'custom':
      return 'Invalid value';
    case 'customAsync':
      return 'Validation failed';
    case 'coerce':
      return 'Invalid value';
    default:
      return 'Invalid value';
  }
}

/**
 * Coerce a value per a `coerce` rule. Returns `ok: false` (a validation
 * failure) when the coercion cannot produce a valid value — `Number('abc')`
 * yielding `NaN`, or `new Date('xyz')` yielding an Invalid Date. Boolean
 * coercion always succeeds (it maps any input to `true`/`false`).
 *
 * Callers MUST ensure `value` is non-empty (`null`/`undefined`/`''` excluded)
 * before calling — those are handled by the `required`/emptiness check.
 */
function coerceValue(
  value: any,
  coerce: NonNullable<ValidationRule['coerce']>,
): { ok: boolean; value: any } {
  switch (coerce) {
    case 'number': {
      const num = Number(value);
      return { ok: !isNaN(num), value: num };
    }
    case 'boolean': {
      const truthy = value === true
        || (typeof value === 'string' && ['true', '1', 'on', 'yes'].includes(value.toLowerCase()));
      return { ok: true, value: truthy };
    }
    case 'date': {
      const d = new Date(value);
      return { ok: !isNaN(d.getTime()), value: d };
    }
    default:
      return { ok: true, value };
  }
}

/**
 * Validate a value against a set of rules (synchronous).
 *
 * The returned `value` is the value that was validated: the coerced value when
 * a `coerce` rule applied, otherwise the original input. `validateObject` uses
 * it to write coerced values back into the returned `data`.
 */
export function validateValue(value: any, rules: ValidationRule): ValidationResult {
  // Check required first (against the raw input — emptiness is never coerced).
  if (rules.required) {
    if (!validators.required(value)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'required'),
      };
    }
  }

  // Skip other validations if value is empty and not required. Coercion does
  // NOT run here, so `""` stays `""` (it never becomes `0` / `false`).
  if (value === null || value === undefined || value === '') {
    return { valid: true, value };
  }

  // Coerce (after the emptiness check) so the remaining checks run against the
  // value the caller will actually receive. A coercion that cannot produce a
  // valid value (NaN / Invalid Date) is a validation failure.
  if (rules.coerce) {
    const result = coerceValue(value, rules.coerce);
    if (!result.ok) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'coerce'),
      };
    }
    value = result.value;
  }

  // minLength
  if (rules.minLength !== undefined) {
    if (!validators.minLength(value, rules.minLength)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'minLength'),
      };
    }
  }

  // maxLength
  if (rules.maxLength !== undefined) {
    if (!validators.maxLength(value, rules.maxLength)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'maxLength'),
      };
    }
  }

  // min
  if (rules.min !== undefined) {
    if (!validators.min(value, rules.min)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'min'),
      };
    }
  }

  // max
  if (rules.max !== undefined) {
    if (!validators.max(value, rules.max)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'max'),
      };
    }
  }

  // pattern
  if (rules.pattern) {
    if (!validators.pattern(value, rules.pattern)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'pattern'),
      };
    }
  }

  // email
  if (rules.email) {
    if (!validators.email(value)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'email'),
      };
    }
  }

  // url
  if (rules.url) {
    if (!validators.url(value)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'url'),
      };
    }
  }

  // custom sync validator
  if (rules.custom) {
    try {
      if (!rules.custom(value)) {
        return {
          valid: false,
          message: rules.message || getDefaultMessage(rules, 'custom'),
        };
      }
    } catch (e) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'custom'),
      };
    }
  }

  return { valid: true, value };
}

/**
 * Validate a value against a set of rules (asynchronous, includes customAsync)
 */
export async function validateValueAsync(
  value: any,
  rules: ValidationRule,
  component?: any
): Promise<ValidationResult> {
  // First run sync validations (syncResult.value is the coerced value, if any).
  const syncResult = validateValue(value, rules);
  if (!syncResult.valid) {
    return syncResult;
  }

  // Check customAsync against the coerced value (syncResult.value).
  if (rules.customAsync) {
    try {
      // Pass component as second argument for access to component methods
      const isValid = await rules.customAsync(syncResult.value, component);
      if (!isValid) {
        return {
          valid: false,
          message: rules.message || getDefaultMessage(rules, 'customAsync'),
        };
      }
    } catch (e) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'customAsync'),
      };
    }
  }

  return { valid: true, value: syncResult.value };
}

/**
 * Result of validating a plain object against a `storeRules<T>()` map.
 *
 * - `errors`: a NESTED object mirroring the form's type structure, so you can
 *   use optional chaining / destructuring: `errors?.address?.city`. Built from
 *   the dot-path rule keys (e.g. `'address.city'` → `errors.address.city`).
 * - `flatErrors`: the same data as a flat `Record<dotPath, string>` — useful if
 *   you need to look up a message by its exact rule key.
 * - `data`: the input typed `T`, with any `coerce` rules applied — fields with
 *   `coerce: 'number'` come back as numbers, etc. Fields without a rule are
 *   echoed unchanged.
 */
export interface ObjectValidationResult<T> {
  data: T;
  errors: NestedErrors<T>;
  flatErrors: Partial<Record<DeepKeysOf<T>, string>>;
  valid: boolean;
}

/**
 * Recursively nest a dot-path key into an object tree.
 * `setNested(root, 'address.city', 'Required')` → `root.address.city = 'Required'`.
 * Intermediate nodes are created as needed.
 */
function setNested(root: Record<string, unknown>, dotPath: string, message: string): void {
  const parts = dotPath.split('.');
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const existing = current[part];
    // Reuse an existing object node, or create one. If a non-object (e.g. a
    // string from a shallower rule) is there, overwrite — deeper rules win.
    if (typeof existing !== 'object' || existing === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = message;
}

/**
 * Resolve a dot-path (`'address.zip'`) against a plain object via bracket
 * access. Returns `undefined` for missing paths (never throws). Works on
 * null-proto objects (used by `parseFormData`).
 */
function resolveDotPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Write a value into a plain object at a dot-path
 * (`setDotPath(root, 'address.zip', x)` → `root.address.zip = x`). Reuses
 * existing intermediate object nodes (creating none) — intended for writing
 * coerced values back into data produced by `parseFormData`, so it never
 * restructures the tree. Silently no-ops if an intermediate segment is missing
 * or non-object.
 */
function setDotPath(root: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== 'object') return;
    const next = (current as Record<string, unknown>)[parts[i]];
    if (next == null || typeof next !== 'object') return;
    current = next;
  }
  if (current != null && typeof current === 'object') {
    (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
  }
}

/**
 * Validate a plain object against a `storeRules<T>()` map WITHOUT a component
 * instance — the component-free counterpart to `validateAll(component)`.
 *
 * Walks each dot-path rule, resolves the value from the object, and runs
 * `validateValueAsync`. Reuses the same dot-path vocabulary as
 * `@Store`/`@Validate` components, so the rules you write here are
 * interchangeable with rules on a store.
 *
 * Notes:
 * - Non-throwing: invalid fields are collected into `errors` (nested) and
 *   `flatErrors` (dot-path keyed); `valid` is the aggregate. The caller decides
 *   what to do (400, re-render, etc.).
 * - `customAsync` callbacks that expect a `component` argument receive
 *   `undefined` here — component-coupled async rules are a component-lifecycle
 *   feature, not a plain-object one.
 * - `coerce` rules transform the returned `data`: e.g. `age: { coerce: 'number',
 *   min: 18 }` turns the FormData string `"20"` into the number `20`.
 *
 * @example
 *   const { data, errors, valid } = await validateObject<MyForm>(parsed, {
 *     email: { required: true, email: true },
 *     address: { zip: { required: true, pattern: /^\d{5}$/ } },
 *   });
 */
export async function validateObject<T>(
  data: T,
  rules: StoreRuleMap<T>,
): Promise<ObjectValidationResult<T>> {
  const flatRules = flattenRuleTree(rules, '');
  const flatErrors: Partial<Record<DeepKeysOf<T>, string>> = {};
  const nestedErrors: Record<string, unknown> = {};
  for (const [dotPath, rule] of Object.entries(flatRules)) {
    if (!rule) continue;
    const value = resolveDotPath(data, dotPath);
    const result = await validateValueAsync(value, rule);
    if (!result.valid) {
      const message = result.message || getDefaultMessage(rule, 'custom');
      (flatErrors as Record<string, string>)[dotPath] = message;
      setNested(nestedErrors, dotPath, message);
    } else if (rule.coerce) {
      // Write the coerced value back into `data` so the returned data carries
      // typed values (e.g. `Number` instead of the original FormData string).
      setDotPath(data, dotPath, result.value);
    }
  }
  const valid = Object.keys(flatErrors).length === 0;
  return { data, errors: nestedErrors as NestedErrors<T>, flatErrors, valid };
}

/**
 * Get validation rules from a component class
 */
export function getValidationRules(target: any): ValidationRulesStore {
  return Reflect.getMetadata('cossack:validation', target.constructor) || {};
}

/**
 * Set validation rules on a component class
 */
export function setValidationRules(
  target: any,
  rules: ValidationRulesStore
): void {
  Reflect.defineMetadata('cossack:validation', rules, target.constructor);
}

// ========== Component validation helpers ==========
// These functions are extracted from the Cossack class body and accept the
// component instance as the first argument. They use the component's public
// getProperty/setProperty helpers and requestUpdate to remain UI-agnostic.

/** Get the error property name from validation config. */
export function getValidationErrorProperty(component: any): string {
    const rules = getValidationRules(component);
    const firstRule = Object.values(rules)[0];
    return firstRule?.config?.errorProperty || 'errors';
}

/**
 * Get the error message for a specific property.
 *
 * Resolves two error shapes transparently:
 * 1. **Flat dot-path keys** (written by the `@Validate` reactive path via
 *    `setValidationError`): `{ 'form.address.zip': '...' }`. A direct lookup
 *    handles both top-level fields (`'name'`) and flat dot-paths.
 * 2. **Nested objects** (returned by `validateObject` / `getFormData({ rules })`
 *    and flashed across a redirect): `{ address: { city: '...' } }. Traversed
 *    via dot-path when the key contains a `.`.
 *
 * Only string leaves count as an error, so asking for a parent node
 * (e.g. `getError('address')`) returns `undefined` rather than the sub-object.
 */
export function getError(component: any, propertyName: string): string | undefined {
    const errorProperty = getValidationErrorProperty(component);
    const errors = component.getProperty(errorProperty) as Record<string, unknown> | undefined;
    if (!errors) return undefined;
    // Flat-key lookup first — handles top-level fields AND @Validate flat
    // dot-paths (e.g. 'form.address.zip').
    const flat = errors[propertyName];
    if (typeof flat === 'string') return flat;
    // Nested dot-path traversal — handles getFormData/validateObject nested
    // errors (e.g. 'address.city' → errors.address.city). Gated on the dot so
    // parent nodes like getError('address') don't return the nested object.
    // Note: @Validate flat keys ('form.address.zip') never reach here — the
    // flat lookup above already returned them. This branch only fires for keys
    // a user passes directly against a nested (flashed) errors object.
    if (propertyName.includes('.')) {
        const nested = resolveDotPath(errors, propertyName);
        if (typeof nested === 'string') return nested;
    }
    return undefined;
}

/** Check if a property has validation errors. */
export function hasError(component: any, propertyName: string): boolean {
    const error = getError(component, propertyName);
    return error !== undefined && error !== '';
}

/** Set validation error for a specific property. */
export function setValidationError(component: any, propertyName: string, message: string): void {
    const errorProperty = getValidationErrorProperty(component);
    const errors = component.getProperty(errorProperty) as Record<string, string> || {};
    errors[propertyName] = message;
    component.setProperty(errorProperty, { ...errors });
    if (!component.isServer) {
        component.requestUpdate();
    }
}

/** Clear validation error for a specific property. */
export function clearValidationError(component: any, propertyName: string): void {
    const errorProperty = getValidationErrorProperty(component);
    const errors = component.getProperty(errorProperty) as Record<string, string> || {};
    if (errors[propertyName]) {
        delete errors[propertyName];
        component.setProperty(errorProperty, { ...errors });
        if (!component.isServer) {
            component.requestUpdate();
        }
    }
}

/**
 * Tracks the latest validation request ID per property per component instance.
 * Used to discard stale async validation results when a newer validation for
 * the same property has started before the previous one finished.
 */
const validationRequestIds = new WeakMap<any, Record<string, number>>();

function getLatestRequestId(component: any, propertyName: string): number {
    const ids = validationRequestIds.get(component);
    return ids?.[propertyName] ?? 0;
}

function bumpRequestId(component: any, propertyName: string): number {
    let ids = validationRequestIds.get(component);
    if (!ids) {
        ids = {};
        validationRequestIds.set(component, ids);
    }
    const next = (ids[propertyName] ?? 0) + 1;
    ids[propertyName] = next;
    return next;
}

/**
 * Validate a single property against its validation rules.
 *
 * @param trigger Optional hint describing what initiated this validation
 *   ('input' | 'blur' | 'submit'). When provided, validation is skipped unless
 *   the rule's configured trigger matches (or is 'all'). Omit to always
 *   validate regardless of config (used by `validateAll` on submit).
 */
export async function validateProperty(
    component: any,
    propertyName: string,
    trigger?: 'input' | 'blur' | 'submit'
): Promise<boolean> {
    const rules = getValidationRules(component);
    const propertyRules = rules[propertyName];

    if (!propertyRules) {
        return true;
    }

    const configTrigger = propertyRules.config.trigger || 'all';

    // If a trigger hint is provided, only validate when it matches the config
    // (or when the config is 'all'). No trigger hint = always validate.
    if (trigger && configTrigger !== 'all' && trigger !== configTrigger) {
        return true;
    }

    const value = resolveStatePath(component, propertyName);
    const { rules: validationRules, config } = propertyRules;

    // Determine where to run validation. Default to 'both' if unset (e.g. for
    // rules registered manually via setValidationRules without config defaults).
    const runOn = config.runOn || 'both';
    const shouldRunOnClient = runOn === 'client' || runOn === 'both';
    const shouldRunOnServer = runOn === 'server' || runOn === 'both';

    // Reserve a request ID for this async sequence. Any stale async result
    // (from a previous call whose ID is no longer the latest) will be ignored.
    const requestId = bumpRequestId(component, propertyName);

    let isValid = true;

    // Run client-side validation (sync and async)
    if (!component.isServer && shouldRunOnClient) {
        // Run sync validation first
        const syncResult = validateValue(value, validationRules);
        isValid = syncResult.valid;
        if (!isValid) {
            // Sync errors are applied immediately; they reflect the current
            // value, so no staleness concern.
            setValidationError(component, propertyName, syncResult.message || 'Validation failed');
        } else if (validationRules.customAsync) {
            // Run async validation if sync passes and there's a customAsync rule
            try {
                const asyncResult = await validateValueAsync(value, validationRules, component);
                // Discard stale result: a newer validation for this property
                // has already started. Do NOT mutate error state or re-render.
                if (getLatestRequestId(component, propertyName) !== requestId) {
                    return isValid;
                }
                isValid = asyncResult.valid;
                if (!asyncResult.valid) {
                    setValidationError(component, propertyName, asyncResult.message || 'Validation failed');
                }
            } catch (e) {
                if (getLatestRequestId(component, propertyName) !== requestId) {
                    return isValid;
                }
                isValid = false;
                setValidationError(component, propertyName, 'Validation failed');
            }
        }
    }

    // Run server-side validation
    if (component.isServer && shouldRunOnServer) {
        const result = await validateValueAsync(value, validationRules, component);
        if (getLatestRequestId(component, propertyName) !== requestId) {
            return isValid;
        }
        isValid = isValid && result.valid;
        if (!result.valid) {
            setValidationError(component, propertyName, result.message || 'Validation failed');
        }
    }

    // If valid, clear any existing error (guard against staleness here too)
    if (isValid) {
        if (getLatestRequestId(component, propertyName) === requestId) {
            clearValidationError(component, propertyName);
        }
    }

    return isValid;
}

/**
 * Validate all properties with validation rules.
 *
 * @param trigger Optional trigger hint forwarded to each `validateProperty`
 *   call. Omit to validate every field regardless of its configured trigger
 *   (used by form submit handlers).
 */
export async function validateAll(
    component: any,
    trigger?: 'input' | 'blur' | 'submit'
): Promise<boolean> {
    const rules = getValidationRules(component);
    const propertyNames = Object.keys(rules);

    const results = await Promise.all(
        propertyNames.map(name => validateProperty(component, name, trigger))
    );

    return results.every(result => result);
}

/** Clear all validation errors. */
export function clearErrors(component: any): void {
    const errorProperty = getValidationErrorProperty(component);
    const errors = component.getProperty(errorProperty);
    if (errors && typeof errors === 'object') {
        component.setProperty(errorProperty, {});
        if (!component.isServer) {
            component.requestUpdate();
        }
    }
}

