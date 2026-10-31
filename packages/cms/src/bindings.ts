/**
 * Dynamic content: a text field may put values inside its text with `{{ $.price }}`, so words
 * and formatting can surround them. A path walks into objects and lists with dots:
 * `{{ $.specs.0.name }}`. Three scopes:
 *
 * - `$`: the entry shown. A widget on an entry's page sees that entry; elsewhere it is empty.
 * - `$site`: the site's public settings, such as `{{ $site.title }}`.
 * - `$user`: the signed-in user, such as `{{ $user.name }}`; empty for visitors. A page that
 *   uses it is not cached for everyone.
 *
 * The site resolves bindings when it renders; the editor keeps the syntax.
 */

/** The scopes a binding can read: `''` for `$` (the entry), `site` and `user`. */
export const BINDING_SCOPES = Object.freeze(['', 'site', 'user'] as const);
export type BindingScope = (typeof BINDING_SCOPES)[number];

/** What bindings read, by scope. A missing scope renders its bindings empty. */
export interface BindingScopes {
    readonly entry?: Readonly<Record<string, unknown>> | null;
    readonly site?: Readonly<Record<string, unknown>> | null;
    readonly user?: Readonly<Record<string, unknown>> | null;
}

/** Bindings inside text: `{{ $.a.b }}`, `{{ $site.title }}`; the scope is captured even when unknown, so it can be reported. */
const INLINE = /\{\{\s*\$([a-z]*)\.([A-Za-z_][\w-]*(?:\.[\w-]+)*)\s*\}\}/g;

/** Whether a value binds to anything at all, so a renderer knows to resolve it. */
export function hasBinding(value: unknown): value is string {
    return typeof value === 'string' && /\{\{\s*\$[a-z]*\./.test(value);
}

/** The bindings of a value, in order, with their scopes. */
export function bindingRefs(value: unknown): { scope: string; path: string }[] {
    if (typeof value !== 'string') return [];
    return [...value.matchAll(INLINE)].map(match => ({ scope: match[1]!, path: match[2]! }));
}

/** The entry field paths a value binds to (`$` only), in order, for pickers and checks. */
export function bindingPaths(value: unknown): string[] {
    return bindingRefs(value).filter(ref => ref.scope === '').map(ref => ref.path);
}

/** Whether a value reads the signed-in user, so the page it is on cannot be cached for everyone. */
export function usesUserBinding(value: unknown): boolean {
    return bindingRefs(value).some(ref => ref.scope === 'user');
}

/** Why a value's bindings are refused: a scope other than `$`, `$site` and `$user`. Undefined when fine. */
export function bindingProblem(value: unknown): string | undefined {
    const unknown = bindingRefs(value).find(ref => !(BINDING_SCOPES as readonly string[]).includes(ref.scope));
    return unknown ? `{{ $${unknown.scope}.${unknown.path} }} reads an unknown scope: use $ (the entry), $site or $user.` : undefined;
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

/** The value with its bindings replaced by the scopes' values, in place. Unknown paths and scopes become empty text. */
export function resolveBindings(value: string, scopes: BindingScopes): string {
    return value.replace(INLINE, (_match, scope: string, path: string) => {
        const source = scope === '' ? scopes.entry : scope === 'site' ? scopes.site : scope === 'user' ? scopes.user : null;
        return source ? bindingText(bindingValue(source, path)) : '';
    });
}

/**
 * A block's data with every bound string field resolved against the scopes; other fields stay.
 * `fields` names the block type's text-like fields (string and text kinds), the only ones that bind.
 */
export function resolveBlockBindings(data: Readonly<Record<string, unknown>>, fields: readonly string[], scopes: BindingScopes): Record<string, unknown> {
    let changed = false;
    const next: Record<string, unknown> = { ...data };
    for (const name of fields) {
        const value = data[name];
        if (!hasBinding(value)) continue;
        next[name] = resolveBindings(value, scopes);
        changed = true;
    }
    return changed ? next : { ...data };
}

/** The value with `{{ $.name }}` appended, after a space when there is text. */
export function withBinding(value: unknown, path: string): string {
    const current = typeof value === 'string' ? value : '';
    return current.trim() === '' ? `{{ $.${path} }}` : `${current}${current.endsWith(' ') ? '' : ' '}{{ $.${path} }}`;
}
