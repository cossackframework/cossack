// src/services/roles.ts
//
// Role-management data access for the /dashboard/roles admin pages. Plain
// functions over the global request-scoped db() — no Context, no state.
// Permissions are validated against the PERMISSIONS constant (config/permissions.ts).

import { db } from '@cossackframework/database';
import { ClientVisibleError } from '@cossackframework/core';
import { uuidv7 } from '../lib/uuid';
import { PERMISSIONS, type Permission } from '../config/permissions';

interface RoleRow {
    id: string;
    name: string;
    permissions: string | null;
    created_at: string;
}

/** A role with its parsed permissions. */
export interface RoleDetail {
    id: string;
    name: string;
    permissions: string[];
    createdAt: string;
}

export interface CreateRoleInput {
    name: string;
    permissions?: Permission[];
}

export interface UpdateRoleInput {
    name?: string;
    permissions?: Permission[];
}

/** Validate that every entry is a known permission; throws on unknown ones. */
function validatePermissions(permissions: string[]): Permission[] {
    const known = new Set<string>(PERMISSIONS);
    const invalid = permissions.filter((p) => !known.has(p));
    if (invalid.length) {
        throw new ClientVisibleError(`Unknown permission(s): ${invalid.join(', ')}`);
    }
    return permissions as Permission[];
}

function toDetail(r: RoleRow): RoleDetail {
    let permissions: string[] = [];
    if (r.permissions) {
        try {
            const parsed = JSON.parse(r.permissions);
            permissions = Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
        } catch {
            permissions = [];
        }
    }
    return { id: r.id, name: r.name, permissions, createdAt: r.created_at };
}

/** List all roles, oldest first. */
export async function listRoles(): Promise<RoleDetail[]> {
    const rows = await db()
        .selectFrom('roles')
        .select(['id', 'name', 'permissions', 'created_at'])
        .orderBy('created_at', 'asc')
        .execute() as RoleRow[];
    return rows.map(toDetail);
}

/** Get a single role. */
export async function getRole(id: string): Promise<RoleDetail | null> {
    const row = await db()
        .selectFrom('roles')
        .where('id', '=', id)
        .select(['id', 'name', 'permissions', 'created_at'])
        .executeTakeFirst() as RoleRow | undefined;
    return row ? toDetail(row) : null;
}

/** Create a role. Permissions default to none. */
export async function createRole(input: CreateRoleInput): Promise<RoleDetail> {
    const existing = await db().selectFrom('roles').where('name', '=', input.name).select('id').executeTakeFirst();
    if (existing) {
        throw new ClientVisibleError('A role with this name already exists.');
    }
    const permissions = input.permissions ? validatePermissions([...input.permissions]) : [];
    const id = uuidv7();
    await db()
        .insertInto('roles')
        .values({
            id,
            name: input.name,
            permissions: JSON.stringify(permissions),
            created_at: new Date().toISOString(),
        })
        .execute();
    return { id, name: input.name, permissions, createdAt: new Date().toISOString() };
}

/** Update a role's name and/or permissions. */
export async function updateRole(id: string, patch: UpdateRoleInput): Promise<void> {
    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) {
        const clash = await db()
            .selectFrom('roles')
            .where('name', '=', patch.name)
            .where('id', '!=', id)
            .select('id')
            .executeTakeFirst();
        if (clash) throw new ClientVisibleError('A role with this name already exists.');
        values.name = patch.name;
    }
    if (patch.permissions !== undefined) {
        const permissions = validatePermissions([...patch.permissions]);
        values.permissions = JSON.stringify(permissions);
    }
    if (Object.keys(values).length === 0) return;
    await db().updateTable('roles').set(values).where('id', '=', id).execute();
}

/** Delete a role and remove it from all users. */
export async function deleteRole(id: string): Promise<void> {
    await db().deleteFrom('user_roles').where('role_id', '=', id).execute();
    await db().deleteFrom('roles').where('id', '=', id).execute();
}
