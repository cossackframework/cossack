import { Like, Not, sql } from '@cossackframework/database';
import { ClientVisibleError } from '@cossackframework/core';
import { uuidv7 } from '../lib/uuid';
import { PERMISSIONS, type Permission } from '../lib/permissions';
import { Role } from '../models/Role';
import { UserRole } from '../models/UserRole';

export interface RoleDetail {
  id: string;
  name: string;
  permissions: string[];
  createdAt: string;
  userCount?: number;
}

export interface ListRolesOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

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

function validatePermissions(permissions: string[]): Permission[] {
  const known = new Set<string>(PERMISSIONS);
  const invalid = permissions.filter((permission) => !known.has(permission));
  if (invalid.length) {
    throw new ClientVisibleError(`Unknown permission(s): ${invalid.join(', ')}`);
  }
  return permissions as Permission[];
}

function toDetail(role: Role): RoleDetail {
  return {
    id: role.id,
    name: role.name,
    permissions: role.permissions ?? [],
    createdAt: role.createdAt.toISOString(),
  };
}

export async function listRoles(): Promise<RoleDetail[]>;
export async function listRoles(options: ListRolesOptions): Promise<ListRolesResult>;
export async function listRoles(options: ListRolesOptions = {}): Promise<RoleDetail[] | ListRolesResult> {
  const { search, page, pageSize } = options;
  if (page === undefined && pageSize === undefined && search === undefined) {
    return (await Role.find({ order: { createdAt: 'asc' } })).map(toDetail);
  }

  const safePage = Math.max(1, page ?? 1);
  const safeSize = Math.max(1, pageSize ?? 20);
  const where = search ? { name: Like(`%${search}%`) } : undefined;
  const [roles, total] = await Promise.all([
    Role.find({
      ...(where ? { where } : {}),
      order: { createdAt: 'asc' },
      take: safeSize,
      skip: (safePage - 1) * safeSize,
    }),
    Role.count(where),
  ]);
  const items = roles.map(toDetail);
  if (items.length) {
    const ids = items.map((role) => role.id);
    const counts = (await sql<{ roleId: string; count: number }>`
      SELECT role_id AS roleId, COUNT(user_id) AS count
      FROM user_roles
      WHERE role_id IN (${ids})
      GROUP BY role_id
    `).rows;
    const byRole = new Map(counts.map((row) => [row.roleId, Number(row.count)]));
    for (const item of items) item.userCount = byRole.get(item.id) ?? 0;
  }
  return { items, total, page: safePage, pageSize: safeSize };
}

export async function getRole(id: string): Promise<RoleDetail | null> {
  const role = await Role.findOne({ where: { id } });
  return role ? toDetail(role) : null;
}

export async function createRole(input: CreateRoleInput): Promise<RoleDetail> {
  if (await Role.exists({ name: input.name })) {
    throw new ClientVisibleError('A role with this name already exists.');
  }
  const now = new Date();
  const permissions = validatePermissions([...(input.permissions ?? [])]);
  await Role.insert({
    id: uuidv7(),
    name: input.name,
    permissions,
    createdAt: now,
  });
  const role = await Role.findOne({ where: { name: input.name } });
  if (!role) throw new Error('Role insert did not return a readable row.');
  return toDetail(role);
}

export async function updateRole(id: string, patch: UpdateRoleInput): Promise<void> {
  const values: Partial<Role> = {};
  if (patch.name !== undefined) {
    if (await Role.exists({ id: Not(id), name: patch.name })) {
      throw new ClientVisibleError('A role with this name already exists.');
    }
    values.name = patch.name;
  }
  if (patch.permissions !== undefined) {
    values.permissions = validatePermissions([...patch.permissions]);
  }
  if (Object.keys(values).length) await Role.update({ id }, values);
}

export async function deleteRole(id: string): Promise<void> {
  await UserRole.delete({ roleId: id });
  await Role.delete({ id });
}
