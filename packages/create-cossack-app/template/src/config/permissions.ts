// src/config/permissions.ts
//
// The single source of truth for permission strings used across the app.
// Roles store an array of these in their `permissions` JSON column.
//
// Add new permissions here as your app grows; the admin seeder grants
// ALL_PERMISSIONS to the `admin` role, and the Roles UI renders these as the
// assignable checkboxes.

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
