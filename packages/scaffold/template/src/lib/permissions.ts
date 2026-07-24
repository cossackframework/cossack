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
