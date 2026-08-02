import { sql } from '@cossackframework/orm';
import { ClientVisibleError } from '@cossackframework/core';
import { uuidv7 } from '../lib/uuid';
import { hashPassword, type PublicUser } from '../auth';
import { User } from '../models/User';
import { UserRole } from '../models/UserRole';
import type { RoleAssignment } from '../models/User';

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  createdAt: string;
  roles: RoleAssignment[];
}

export interface UserDetail extends UserSummary {}

export interface ListUsersOptions {
  search?: string;
  roleId?: string;
  page?: number;
  pageSize?: number;
}

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

type RoleRow = { userId?: string; id: string; name: string; permissions: string | null };

function safeParseStrings(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function parseRoles(rows: readonly RoleRow[]): RoleAssignment[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    permissions: safeParseStrings(row.permissions),
  }));
}

async function roleRowsForUsers(userIds: readonly string[]): Promise<readonly RoleRow[]> {
  if (!userIds.length) return [];
  return (await sql<RoleRow>`
    SELECT ur.user_id AS userId, r.id, r.name, r.permissions
    FROM user_roles ur
    INNER JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id IN (${userIds})
  `).rows;
}

export async function listUsers(options: ListUsersOptions = {}): Promise<ListUsersResult> {
  const { search, roleId, page = 1, pageSize = 20 } = options;
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, pageSize);
  const like = search ? `%${search}%` : null;
  const roleFilter = roleId
    ? sql.fragment`AND u.id IN (SELECT user_id FROM user_roles WHERE role_id = ${roleId})`
    : sql.fragment``;
  const searchFilter = like
    ? sql.fragment`AND (u.name LIKE ${like} OR u.email LIKE ${like})`
    : sql.fragment``;

  const [pageResult, countResult] = await Promise.all([
    sql<{ id: string; email: string; name: string | null; avatar: string | null; createdAt: string }>`
      SELECT u.id, u.email, u.name, u.avatar, u.created_at AS createdAt
      FROM users u
      WHERE 1 = 1 ${searchFilter} ${roleFilter}
      ORDER BY u.created_at DESC
      LIMIT ${safeSize} OFFSET ${(safePage - 1) * safeSize}
    `,
    sql<{ total: number }>`
      SELECT COUNT(*) AS total FROM users u
      WHERE 1 = 1 ${searchFilter} ${roleFilter}
    `,
  ]);
  const items: UserSummary[] = pageResult.rows.map((row) => ({
    ...row,
    name: row.name ?? '',
    roles: [],
  }));
  const roleRows = await roleRowsForUsers(items.map((user) => user.id));
  const byUser = new Map<string, RoleAssignment[]>();
  for (const row of roleRows) {
    const roles = byUser.get(row.userId!) ?? [];
    roles.push(...parseRoles([row]));
    byUser.set(row.userId!, roles);
  }
  for (const item of items) item.roles = byUser.get(item.id) ?? [];
  return {
    items,
    total: Number(countResult.rows[0]?.total ?? 0),
    page: safePage,
    pageSize: safeSize,
  };
}

export async function getUser(id: string): Promise<UserDetail | null> {
  const user = await User.findOne({ where: { id } });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? '',
    avatar: user.avatar,
    createdAt: user.createdAt,
    roles: parseRoles(await roleRowsForUsers([id])),
  };
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  if (await User.exists({ email: input.email })) {
    throw new ClientVisibleError('An account with this email already exists.');
  }
  const id = uuidv7();
  await User.insert({
    id,
    email: input.email,
    name: input.name ?? null,
    passwordHash: await hashPassword(input.password),
    avatar: null,
    meta: null,
    createdAt: new Date().toISOString(),
  });
  return { id, email: input.email, name: input.name ?? '', avatar: null, meta: null, roles: [] };
}

export async function updateUser(id: string, patch: UpdateUserInput): Promise<void> {
  if (Object.keys(patch).length) await User.update({ id }, patch);
}

export async function changeUserPassword(id: string, newPassword: string): Promise<void> {
  if (!(await User.exists({ id }))) throw new ClientVisibleError('User not found.');
  await User.update({ id }, { passwordHash: await hashPassword(newPassword) });
}

export async function deleteUser(id: string): Promise<void> {
  await UserRole.delete({ userId: id });
  await User.delete({ id });
}

export async function assignRole(userId: string, roleId: string): Promise<void> {
  await UserRole.upsert(
    { userId, roleId, createdAt: new Date().toISOString() },
    ['userId', 'roleId'],
  );
}

export async function removeRole(userId: string, roleId: string): Promise<void> {
  await UserRole.delete({ userId, roleId });
}

export async function syncUserRoles(userId: string, roleIds: string[]): Promise<void> {
  await UserRole.delete({ userId });
  if (roleIds.length) {
    const createdAt = new Date().toISOString();
    await UserRole.insert(roleIds.map((roleId) => ({ userId, roleId, createdAt })));
  }
}
