/**
 * Dynamic block content: a block's text field may name a field of the entry it is rendered on
 * instead of holding text. `$.price` as the whole value shows that field; `{{ $.price }}` inside
 * text puts the field there. A path walks into objects and lists with dots: `$.specs.0.name`.
 * The site resolves bindings when it renders an entry's blocks; the editor keeps the syntax.
 */

/** A path the whole value is: `$.a.b`. */
const WHOLE = /^\s*\$\.([A-Za-z_][\w-]*(?:\.[\w-]+)*)\s*$/;
/** Paths inside text: `{{ $.a.b }}`. */
const INLINE = /\{\{\s*\$\.([A-Za-z_][\w-]*(?:\.[\w-]+)*)\s*\}\}/g;

/** Whether a value binds to a field at all, so a renderer knows to resolve it. */
export function hasBinding(value: unknown): value is string {
    return typeof value === 'string' && (WHOLE.test(value) || /\{\{\s*\$\./.test(value));
}

/** The field paths a value binds to, in order, for pickers and checks. */
export function bindingPaths(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    const whole = WHOLE.exec(value);
    if (whole) return [whole[1]!];
    return [...value.matchAll(INLINE)].map(match => match[1]!);
}

/** The value at a dotted path of the scope; undefined when the path leads nowhere. */
export function bindingValue(scope: Readonly<Record<string, unknown>>, path: string): unknown {
    let current: unknown = scope;
    for (const part of path.split('.')) {
        if (current === null || current === undefined) return undefined;
        if (Array.isArray(current)) { const index = Number(part); current = Number.isInteger(index) ? current[index] : undefined; continue; }
        if (typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

/**
 * A field's value as text for a block: numbers and booleans as they are written, lists joined
 * with commas, dates (fields of kind datetime hold milliseconds) left as numbers for the theme
 * to format, objects as nothing. Rich text and blocks do not bind; use their own blocks.
 */
export function bindingText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (Array.isArray(value)) return value.map(bindingText).filter(Boolean).join(', ');
    return '';
}

/**
 * The value with its bindings replaced by the scope's fields. A whole-value binding becomes the
 * field's text; inline bindings are replaced in place. Unknown paths become empty text.
 */
export function resolveBindings(value: string, scope: Readonly<Record<string, unknown>>): string {
    const whole = WHOLE.exec(value);
    if (whole) return bindingText(bindingValue(scope, whole[1]!));
    return value.replace(INLINE, (_match, path: string) => bindingText(bindingValue(scope, path)));
}

/**
 * A block's data with every bound string field resolved against the scope; other fields stay.
 * `fields` names the block type's text-like fields (string and text kinds), the only ones that bind.
 */
export function resolveBlockBindings(data: Readonly<Record<string, unknown>>, fields: readonly string[], scope: Readonly<Record<string, unknown>>): Record<string, unknown> {
    let changed = false;
    const next: Record<string, unknown> = { ...data };
    for (const name of fields) {
        const value = data[name];
        if (!hasBinding(value)) continue;
        next[name] = resolveBindings(value, scope);
        changed = true;
    }
    return changed ? next : { ...data };
}

/** The field a binding picker inserts: `$.name` alone in an empty value, `{{ $.name }}` appended to text. */
export function withBinding(value: unknown, path: string): string {
    const current = typeof value === 'string' ? value : '';
    return current.trim() === '' ? `$.${path}` : `${current}${current.endsWith(' ') ? '' : ' '}{{ $.${path} }}`;
}
