// src/shared/forms.ts

/**
 * Form-data helpers.
 *
 * `parseFormData` converts a flat `FormData` (or plain record) whose keys use
 * PHP-style bracket notation into a nested object/array:
 *
 *   address[street]=...        -> { address: { street: ... } }
 *   tags[]=a & tags[]=b         -> { tags: ['a', 'b'] }
 *   address[street][]=...      -> { address: { street: [...] } }
 *   contacts[][email]=...      -> { contacts: [{ email: ... }, ...] }
 *
 * Design notes:
 * - Brackets only (no dot-path parsing). `allowDots`-style ambiguity
 *   (`api.version`: flat key or nested?) is avoided on purpose; the dot-path
 *   syntax used by the *validation* rules API (`storeRules`) is a separate,
 *   programmatic layer and is unaffected.
 * - Matches the reference behavior of the `qs` library for positional `[]`:
 *   consecutive `contacts[][email]` + `contacts[][name]` keys fill the SAME
 *   array element (merged object); a repeated inner key
 *   (`contacts[][email]` twice) opens a new element.
 * - Prototype-pollution safe: containers are created with
 *   `Object.create(null)`, the parser descends only into containers it made
 *   itself (never into a repeated key's values, a string or a File), and a key
 *   with a `__proto__`, `constructor` or `prototype` segment is dropped, so the
 *   result is also safe to spread or `Object.assign` into another object. A key
 *   that conflicts with an earlier one (`a=1` then `a[x]=2`) is dropped too.
 */

/**
 * A segment of a parsed key path.
 * - `string` segments are object property names.
 * - `ARRAY_NEXT` means "positional array slot" (a bare `[]` in the source key).
 */
export type PathSegment = string | typeof ARRAY_NEXT;

/**
 * Sentinel marking a positional array slot (`[]`) in a parsed key path.
 * A unique symbol keeps it distinct from any real string key.
 */
export const ARRAY_NEXT: unique symbol = Symbol('array-next');

/**
 * Create an intermediate object container. Uses `Object.create(null)` so there
 * is no prototype chain — assigning to `obj['__proto__']` is a normal own
 * property write, not a prototype-pollution vector. Keys are preserved exactly.
 */
function createContainer(made?: WeakSet<object>): Record<string, unknown> {
  const container = Object.create(null) as Record<string, unknown>;
  made?.add(container);
  return container;
}

/**
 * Key segments refused outright. Containers are null-prototype, but a key can
 * still reach a value the parser did not create (an array of repeated values,
 * a string, a File), whose prototype chain these names walk.
 */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Tokenize a flat key into path segments.
 *
 *   'name'                 -> ['name']
 *   'address[street]'      -> ['address', 'street']
 *   'tags[]'               -> ['tags', ARRAY_NEXT]
 *   'address[street][]'    -> ['address', 'street', ARRAY_NEXT]
 *   'contacts[][email]'    -> ['contacts', ARRAY_NEXT, 'email']
 *   'a[b][c][d]'           -> ['a', 'b', 'c', 'd']
 *
 * A bare `[]` becomes `ARRAY_NEXT`; brackets with content become string
 * segments. Stray characters between/after brackets are skipped, and an
 * unterminated bracket stops parsing. An entirely empty key yields `[]`
 * (the value is then ignored by `assignPath`).
 */
export function parseKeyPath(key: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const firstBracket = key.indexOf('[');

  if (firstBracket === -1) {
    // No brackets: a single property name.
    if (key.length > 0) segments.push(key);
    return segments;
  }

  // Leading segment before the first '['.
  if (firstBracket > 0) {
    segments.push(key.slice(0, firstBracket));
  }
  // firstBracket === 0 (key like '[foo]') has no leading name; the bracket
  // groups below still produce their segments.

  let i = firstBracket;
  while (i < key.length) {
    if (key[i] !== '[') {
      // Stray char between/after bracket groups — skip to next bracket.
      i++;
      continue;
    }
    const close = key.indexOf(']', i + 1);
    if (close === -1) break; // unterminated — stop
    const inner = key.slice(i + 1, close);
    segments.push(inner === '' ? ARRAY_NEXT : inner);
    i = close + 1;
  }

  return segments;
}

/**
 * Convert a flat `FormData` / record with PHP-style bracket keys into a nested
 * object. Scalar leaves stay scalar; `[]`-suffixed or repeated keys become
 * arrays. `File` objects pass through untouched.
 *
 * @example
 *   const data = parseFormData(await this.c.req.formData());
 *   // data.address.street, data.address.city, data.tags[0], ...
 */
export function parseFormData(
  input: FormData | Record<string, unknown>,
): Record<string, unknown> {
  // Every object or array this parse created. The parser descends only into
  // these: a key whose path meets anything else (a repeated value's array, a
  // string, a File) conflicts with an earlier key and is dropped.
  const made = new WeakSet<object>();
  const root = createContainer(made);

  // Normalize to [key, value] pairs. We collect first to handle both FormData
  // and plain records uniformly (and sidestep the Workers vs DOM FormData type
  // divergence around `entries()`). A record value that is itself an array
  // (e.g. a multi-file input gathered upstream) is spread across repeated keys
  // so the `[]`-append path applies uniformly.
  const pairs: Array<[string, unknown]> = [];
  if (typeof FormData !== 'undefined' && input instanceof FormData) {
    input.forEach((value, key) => pairs.push([key, value]));
  } else {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      pairs.push([k, v]);
    }
  }

  for (const [rawKey, rawValue] of pairs) {
    const segments = parseKeyPath(rawKey);
    if (segments.length === 0) continue; // ignore values with an empty key
    if (segments.some(segment => typeof segment === 'string' && FORBIDDEN_SEGMENTS.has(segment))) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      assignPath(root, segments, value, made);
    }
  }

  return root;
}

/**
 * Assign `value` at the path described by `segments`, creating intermediate
 * objects/arrays as needed.
 *
 * Container choice: when descending through a segment, the child container is
 * an array iff the *next* segment is `ARRAY_NEXT`, otherwise an object (or the
 * leaf scalar at the end). This is what makes `contacts[]...` produce an array
 * while `address[street]` produces an object.
 *
 * Leaf rules (no post-processing needed):
 * - single value, no `[]`            -> scalar
 * - `[]` (positional) leaf           -> appended array element (always array)
 * - repeated key without `[]`        -> array (2nd+ values promote to array)
 *
 * Positional (`ARRAY_NEXT`) interior merge rule (qs-compatible): the LAST
 * array element is reused when it's an object that doesn't already have the
 * key about to be set; otherwise a new element is appended. This is stateless
 * — only the current last element is inspected — so interleaved keys resolve
 * deterministically.
 */
function assignPath(
  root: Record<string, unknown>,
  segments: PathSegment[],
  value: unknown,
  made: WeakSet<object>,
): void {
  // `container` is the object-or-array we're currently writing into. The root
  // is always an object; arrays only appear as nested children. We treat it as
  // a mutable any-container internally — the public API only ever returns the
  // object-shaped root, so this doesn't leak.
  let container = root as AnyContainer;

  for (let depth = 0; depth < segments.length; depth++) {
    const seg = segments[depth];
    const isLast = depth === segments.length - 1;
    const nextSeg: PathSegment | undefined = segments[depth + 1];

    if (seg === ARRAY_NEXT) {
      // A positional slot needs an array this parse made (see `made`).
      if (!Array.isArray(container)) return;
      const arr = container as unknown[];
      if (isLast) {
        // Leaf positional slot: always append (the author asked for an array).
        arr.push(value);
        return;
      }
      // Interior positional slot: reuse the last element if it can absorb the
      // upcoming key, else append a new container.
      const childIsArray = nextSeg === ARRAY_NEXT;
      const last = arr[arr.length - 1];
      const nextKey = typeof nextSeg === 'string' ? nextSeg : undefined;
      const canMerge =
        last !== undefined &&
        typeof last === 'object' &&
        last !== null &&
        made.has(last) &&
        !Array.isArray(last) &&
        nextKey !== undefined &&
        !(nextKey in (last as Record<string, unknown>));
      if (canMerge) {
        container = last as AnyContainer;
      } else {
        const slot: unknown = childIsArray ? madeArray(made) : createContainer(made);
        arr.push(slot);
        container = slot as AnyContainer;
      }
      continue;
    }

    // String segment: a property of an object this parse made; a named key on
    // an array conflicts with the earlier positional keys and is dropped.
    if (Array.isArray(container)) return;
    const obj = container as Record<string, unknown>;
    if (isLast) {
      const existing = obj[seg];
      if (existing === undefined || existing === null) {
        obj[seg] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        obj[seg] = [existing, value];
      }
      return;
    }

    // Descend, creating the next container if missing. An array is created
    // only when the upcoming segment is positional (`[]`); an object container
    // is null-proto (pollution-safe).
    const childIsArray = nextSeg === ARRAY_NEXT;
    let child = obj[seg];
    if (child === undefined || child === null) {
      child = childIsArray ? madeArray(made) : createContainer(made);
      obj[seg] = child;
    }
    // Descend only into a container this parse made, of the shape the next
    // segment needs. Anything else (`a=1` then `a[x]=2`, or a repeated key's
    // values then `a[x]`) is a conflicting key: the later one is dropped.
    if (typeof child !== 'object' || child === null || !made.has(child) || Array.isArray(child) !== childIsArray) return;
    container = child as AnyContainer;
  }
}

function madeArray(made: WeakSet<object>): unknown[] {
  const array: unknown[] = [];
  made.add(array);
  return array;
}

/** Internal mutable container — an object or array we're writing into. */
type AnyContainer = Record<string, unknown> | unknown[];
