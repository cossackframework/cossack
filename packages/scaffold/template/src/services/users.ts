// src/services/users.ts
//
// User-management data access for the /dashboard/users admin pages. Plain
// functions over the global request-scoped db() — no Context, no state —
// mirroring the pattern used in src/auth.ts (e.g. listUserSessions).

import { db } from '@cossackframework/database';
import { ClientVisibleError } from '@cossackframework/core';
import { uuidv7 } from '../lib/uuid';
import { hashPassword, type PublicUser } from '../auth';
import type { RoleAssignment } from '../models/User';

interface UserRow {
    id: string;
    email: string;
    name: string | null;
    avatar: string | null;
    meta: string | null;
    password_hash: string | null;
    created_at: string;
}

/** Lightweight user row for list views. */
export interface UserSummary {
    id: string;
    email: string;
    name: string;
    avatar: string | null;
    createdAt: string;
    /** Role names assigned to the user (for the list view's role column). */
    roles: RoleAssignment[];
}

/** A user with their roles expanded (for the detail/edit page). */
export interface UserDetail extends UserSummary {
}

/** Options for the paginated/filtered user list. */
export interface ListUsersOptions {
    /** Case-insensitive substring match on name or email. */
    search?: string;
    /** Restrict to users assigned this role id. */
    roleId?: string;
    /** 1-based page number. Defaults to 1. */
    page?: number;
    /** Rows per page. Defaults to 20. */
    pageSize?: number;
}

/** Paginated list result. */
export interface ListUsersResult {
    items: UserSummary[];
    total: number;
    page: number;
    pageSize: number;
}

export interface CreateUserInput {
    email: string;
    password: string;
    name?: string;
}

export interface UpdateUserInput {
    name?: string;
    email?: string;
    avatar?: string | null;
}

function parseRoles(rows: Array<{ id: string; name: string; permissions: string | null }>): RoleAssignment[] {
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        permissions: r.permissions ? safeParseStrings(r.permissions) : [],
    }));
}

function safeParseStrings(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * List users with optional search, role filter, and pagination.
 *
 * `search` is a case-insensitive substring on name OR email (SQLite's LIKE is
 * case-insensitive for ASCII by default). `roleId` restricts to users assigned
 * that role. Pagination is 1-based. Each row includes its role assignments
 * (joined) so the list can show a roles column without N+1 queries.
 *
 * Call with no args for the simple "all users, newest first" behavior.
 */
export async function listUsers(options: ListUsersOptions = {}): Promise<ListUsersResult> {
    const { search, roleId, page = 1, pageSize = 20 } = options;
    const safePage = Math.max(1, page);
    const safeSize = Math.max(1, pageSize);

    // Base query with an optional role-membership filter. We build two queries
    // off the same expression: one for the page of rows, one for the total.
    // `selectFrom` is rebuilt (not chained) so the count and page queries share
    // the same where-clause shape without leaking LIMIT/OFFSET into the count.
    let base = db().selectFrom('users');
    if (search) {
        const like = `%${search}%`;
        base = base.where((eb) => eb.or([eb('name', 'like', like), eb('email', 'like', like)]));
    }
    if (roleId) {
        base = base.where('id', 'in',
            db().selectFrom('user_roles').select('user_id').where('role_id', '=', roleId),
        );
    }

    const [rows, countRow] = await Promise.all([
        base
            .select(['id', 'email', 'name', 'avatar', 'created_at'])
            .orderBy('created_at', 'desc')
            .limit(safeSize)
            .offset((safePage - 1) * safeSize)
            .execute() as Promise<UserRow[]>,
        base.select((eb) => eb.fn.count<number>('id').as('total')).executeTakeFirst() as Promise<{ total: number } | undefined>,
    ]);

    const total = Number(countRow?.total ?? rows.length);
    const items: UserSummary[] = rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name ?? '',
        avatar: r.avatar,
        createdAt: r.created_at,
        roles: [],
    }));

    // Batch-load roles for just this page's users (avoids N+1 on the list).
    if (items.length > 0) {
        const userIds = items.map((u) => u.id);
        const roleRows = await db()
            .selectFrom('user_roles')
            .innerJoin('roles', 'roles.id', 'user_roles.role_id')
            .where('user_roles.user_id', 'in', userIds)
            .select(['user_roles.user_id as userId', 'roles.id as id', 'roles.name as name', 'roles.permissions as permissions'])
            .execute() as Array<{ userId: string; id: string; name: string; permissions: string | null }>;
        const byUser = new Map<string, RoleAssignment[]>();
        for (const rr of roleRows) {
            const list = byUser.get(rr.userId) ?? [];
            list.push({ id: rr.id, name: rr.name, permissions: rr.permissions ? safeParseStrings(rr.permissions) : [] });
            byUser.set(rr.userId, list);
        }
        for (const item of items) {
            item.roles = byUser.get(item.id) ?? [];
        }
    }

    return { items, total, page: safePage, pageSize: safeSize };
}

/** Get a single user with their roles. */
export async function getUser(id: string): Promise<UserDetail | null> {
    const row = await db()
        .selectFrom('users')
        .where('id', '=', id)
        .select(['id', 'email', 'name', 'avatar', 'created_at'])
        .executeTakeFirst() as UserRow | undefined;
    if (!row) return null;
    const roleRows = await db()
        .selectFrom('user_roles')
        .innerJoin('roles', 'roles.id', 'user_roles.role_id')
        .where('user_roles.user_id', '=', id)
        .select(['roles.id as id', 'roles.name as name', 'roles.permissions as permissions'])
        .execute() as Array<{ id: string; name: string; permissions: string | null }>;
    return {
        id: row.id,
        email: row.email,
        name: row.name ?? '',
        avatar: row.avatar,
        createdAt: row.created_at,
        roles: parseRoles(roleRows),
    };
}

/** Admin-initiated user creation (mirrors registerUser, no auto-login). */
export async function createUser(input: CreateUserInput): Promise<PublicUser> {
    const existing = await db()
        .selectFrom('users')
        .where('email', '=', input.email)
        .select('id')
        .executeTakeFirst();
    if (existing) {
        throw new ClientVisibleError('An account with this email already exists.');
    }
    const id = uuidv7();
    const passwordHash = await hashPassword(input.password);
    await db()
        .insertInto('users')
        .values({
            id,
            email: input.email,
            name: input.name ?? null,
            password_hash: passwordHash,
            created_at: new Date().toISOString(),
        })
        .execute();
    return { id, email: input.email, name: input.name ?? '', avatar: null, meta: null, roles: [] };
}

/** Update editable user fields. */
export async function updateUser(id: string, patch: UpdateUserInput): Promise<void> {
    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.email !== undefined) values.email = patch.email;
    if (patch.avatar !== undefined) values.avatar = patch.avatar;
    if (Object.keys(values).length === 0) return;
    await db().updateTable('users').set(values).where('id', '=', id).execute();
}

/**
 * Replace a user's password. Reuses the auth password hasher so the scheme
 * stays consistent with registration/login. Throws ClientVisibleError if the
 * user does not exist.
 */
export async function changeUserPassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    const result = await db()
        .updateTable('users')
        .set({ password_hash: passwordHash })
        .where('id', '=', id)
        .executeTakeFirst();
    if (!result || Number(result.numUpdatedRows ?? 0) === 0) {
        throw new ClientVisibleError('User not found.');
    }
}

/** Delete a user and their role assignments. */
export async function deleteUser(id: string): Promise<void> {
    await db().deleteFrom('user_roles').where('user_id', '=', id).execute();
    await db().deleteFrom('users').where('id', '=', id).execute();
}

/** Assign a role to a user (idempotent — duplicate (user,role) inserts are ignored). */
export async function assignRole(userId: string, roleId: string): Promise<void> {
    await db()
        .insertInto('user_roles')
        .values({ user_id: userId, role_id: roleId, created_at: new Date().toISOString() })
        .onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing())
        .execute();
}

/** Remove a role from a user. */
export async function removeRole(userId: string, roleId: string): Promise<void> {
    await db()
        .deleteFrom('user_roles')
        .where('user_id', '=', userId)
        .where('role_id', '=', roleId)
        .execute();
}

/** Replace a user's roles with the given set (convenience for the edit page). */
export async function syncUserRoles(userId: string, roleIds: string[]): Promise<void> {
    await db().deleteFrom('user_roles').where('user_id', '=', userId).execute();
    if (roleIds.length === 0) return;
    const now = new Date().toISOString();
    await db()
        .insertInto('user_roles')
        .values(roleIds.map((roleId) => ({ user_id: userId, role_id: roleId, created_at: now })))
        .execute();
}
