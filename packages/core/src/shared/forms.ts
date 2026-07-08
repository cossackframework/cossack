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
 * - Prototype-pollution safe by construction: intermediate containers are
 *   created with `Object.create(null)`, which has no `__proto__` setter, so a
 *   crafted field name like `__proto__[polluted]` just creates a normal own
 *   property instead of reaching `Object.prototype`. This is the exact CVE
 *   class that pushed Express 5 and Fastify away from auto-nesting form bodies;
 *   Cossack keeps the convenience but closes the hole structurally (and exact
 *   key names are preserved, not mangled).
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
function createContainer(): Record<string, unknown> {
  return Object.create(null);
}

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
  const root = createContainer();

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
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      assignPath(root, segments, value);
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
        !Array.isArray(last) &&
        nextKey !== undefined &&
        !(nextKey in (last as Record<string, unknown>));
      if (canMerge) {
        container = last as AnyContainer;
      } else {
        const slot: unknown = childIsArray ? [] : createContainer();
        arr.push(slot);
        container = slot as AnyContainer;
      }
      continue;
    }

    // String segment: object property access.
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
      child = childIsArray ? [] : createContainer();
      obj[seg] = child;
    }
    container = child as AnyContainer;
  }
}

/** Internal mutable container — an object or array we're writing into. */
type AnyContainer = Record<string, unknown> | unknown[];
