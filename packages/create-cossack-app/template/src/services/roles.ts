// src/services/roles.ts
//
// Role-management data access for the /dashboard/roles admin pages. Plain
// functions over the global request-scoped db() — no Context, no state.
// Permissions are validated against the PERMISSIONS constant (config/permissions.ts).

import { db } from '@cossackframework/database';
import { ClientVisibleError } from '@cossackframework/core';
import { uuidv7 } from '../lib/uuid';
import { PERMISSIONS, type Permission } from '../lib/permissions';

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
    /** Number of users assigned this role (populated by listRoles; 0 when unset). */
    userCount?: number;
}

/** Options for the paginated/filtered role list. */
export interface ListRolesOptions {
    /** Case-insensitive substring match on name. */
    search?: string;
    /** 1-based page number. Defaults to 1. */
    page?: number;
    /** Rows per page. Defaults to 20. */
    pageSize?: number;
}

/** Paginated role list result. */
export interface ListRolesResult {
    items: RoleDetail[];
    total: number;
    page: number;
    pageSize: number;
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

/**
 * List roles, optionally filtered/paginated.
 *
 * Overloaded: with no args (or only fields that don't trigger pagination),
 * returns the full `RoleDetail[]` (used by the user edit page's role checkbox
 * list). With `page`/`pageSize`/`search`, returns a paginated `ListRolesResult`
 * (used by the roles list page). TypeScript picks the right return type from
 * the call shape, so callers don't have to narrow a union.
 */
export async function listRoles(): Promise<RoleDetail[]>;
export async function listRoles(options: ListRolesOptions): Promise<ListRolesResult>;
export async function listRoles(options: ListRolesOptions = {}): Promise<RoleDetail[] | ListRolesResult> {
    const { search, page, pageSize } = options;
    // No pagination requested → return the full list (backward-compatible shape).
    if (page === undefined && pageSize === undefined && search === undefined) {
        const rows = await db()
            .selectFrom('roles')
            .select(['id', 'name', 'permissions', 'created_at'])
            .orderBy('created_at', 'asc')
            .execute() as RoleRow[];
        return rows.map(toDetail);
    }

    const safePage = Math.max(1, page ?? 1);
    const safeSize = Math.max(1, pageSize ?? 20);
    let base = db().selectFrom('roles');
    if (search) {
        base = base.where('name', 'like', `%${search}%`);
    }
    const [rows, countRow] = await Promise.all([
        base
            .select(['id', 'name', 'permissions', 'created_at'])
            .orderBy('created_at', 'asc')
            .limit(safeSize)
            .offset((safePage - 1) * safeSize)
            .execute() as Promise<RoleRow[]>,
        base.select((eb) => eb.fn.count<number>('id').as('total')).executeTakeFirst() as Promise<{ total: number } | undefined>,
    ]);
    const total = Number(countRow?.total ?? rows.length);
    const items = rows.map(toDetail);

    // Batch-load user counts per role for just this page (avoids N+1). The
    // roles list shows a "Users" column instead of the verbose permissions list.
    if (items.length > 0) {
        const roleIds = items.map((r) => r.id);
        const countRows = await db()
            .selectFrom('user_roles')
            .where('role_id', 'in', roleIds)
            .select('role_id')
            .select((eb) => eb.fn.count<number>('user_id').as('count'))
            .groupBy('role_id')
            .execute() as Array<{ role_id: string; count: number }>;
        const byRole = new Map(countRows.map((r) => [r.role_id, Number(r.count)]));
        for (const item of items) {
            item.userCount = byRole.get(item.id) ?? 0;
        }
    }

    return { items, total, page: safePage, pageSize: safeSize };
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
