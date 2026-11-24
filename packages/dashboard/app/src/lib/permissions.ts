// src/lib/permissions.ts
//
// The single source of truth for permission strings used across the app.
// Roles store an array of these in their `permissions` JSON column.
//
// Add new permissions here as your app grows; the admin seeder grants
// ALL_PERMISSIONS to the `admin` role, and the Roles UI renders these as the
// assignable checkboxes.
//
// NOTE: this is a constants module, not a config factory, so it lives in
// src/lib/ rather than src/config/. The framework's config loader auto-loads
// every src/config/*.ts file and requires each to default-export a factory
// `({ env }) => ({...})`; a constants file there would crash the loader.

export const PERMISSIONS = [
    'user:read',
    'user:create',
    'user:update',
    'user:delete',
    'role:read',
    'role:create',
    'role:update',
    'role:delete',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

/** A readable name for a permission: `user:create` reads "Create users". */
export function permissionLabel(permission: string): string {
    const [subject, action] = permission.split(':');
    return subject && action ? `${action.charAt(0).toUpperCase()}${action.slice(1)} ${subject}s` : permission;
}

/**
 * Permission patterns: `*` matches everything, and a pattern that ends with `*` matches every
 * permission that starts with what is before it (`user:*` is every action on users).
 */
export function permissionMatches(pattern: string, permission: string): boolean {
    if (pattern === '*' || pattern === permission) return true;
    return pattern.endsWith('*') && permission.startsWith(pattern.slice(0, -1));
}

/** Whether one of the held patterns gives the permission. */
export function holds(held: readonly string[], permission: string): boolean {
    return held.some(pattern => permissionMatches(pattern, permission));
}

/**
 * Whether the held patterns give every one of the permissions, each as written (so `user:*`
 * needs `user:*` or `*`): what a role manager may put in a role or give someone, without
 * reaching beyond their own permissions.
 */
export function holdsAll(held: readonly string[], permissions: readonly string[]): boolean {
    return permissions.every(permission => holds(held, permission));
}

/** A permission a role may hold: one of the list, `*`, or a pattern over the list such as `user:*`. */
export function validPermission(permission: string, known: readonly string[] = PERMISSIONS): boolean {
    if (permission === '*' || known.includes(permission)) return true;
    return /^[a-z][a-z0-9_/:-]*\*$/.test(permission) && known.some(entry => entry.startsWith(permission.slice(0, -1)));
}
