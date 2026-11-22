import { Like, Not, sql } from '@cossackframework/database';
import { ClientVisibleError, getRequestContext } from '@cossackframework/core';
import { uuidv7 } from '../lib/uuid';
import { holdsAll, validPermission } from '../lib/permissions';
import { permissionsOf } from './rbac';
import { Role } from '@/models/Role';
import { UserRole } from '@/models/UserRole';

const ADMIN_ROLE = 'admin';

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
  /** Permissions of the list, `*`, or patterns over the list such as `user:*`. */
  permissions?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  permissions?: string[];
}

/** Who changes a role: with one, the role gets only permissions the actor holds. */
export interface RoleActor { roles: readonly { name: string; permissions: readonly string[] }[] }

/** The signed-in user of this request changes the role, unless the caller names another actor. A seeder or a command has none. */
function requestActor(): RoleActor | undefined {
  return getRequestContext()?.get('user' as never) as RoleActor | undefined;
}

function validatePermissions(permissions: string[], actor?: RoleActor): string[] {
  const invalid = permissions.filter((permission) => !validPermission(permission));
  if (invalid.length) {
    throw new ClientVisibleError(`Unknown permission(s): ${invalid.join(', ')}`);
  }
  // A role manager gives only permissions they hold.
  const missing = actor ? permissions.filter((permission) => !holdsAll(permissionsOf(actor), [permission])) : [];
  if (missing.length) throw new ClientVisibleError(`You cannot give a role permissions you do not have: ${missing.join(', ')}.`);
  return [...new Set(permissions)].sort();
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

/** The role new accounts get. Accounts start without one; assign roles on the user screen. */
export async function defaultRole(): Promise<RoleDetail | null> {
  return null;
}

export async function getRole(id: string): Promise<RoleDetail | null> {
  const role = await Role.findOne({ where: { id } });
  return role ? toDetail(role) : null;
}

export async function createRole(input: CreateRoleInput, actor: RoleActor | undefined = requestActor()): Promise<RoleDetail> {
  if (input.name === ADMIN_ROLE) throw new ClientVisibleError('admin is the administrators\' role; choose another name.');
  if (await Role.exists({ name: input.name })) {
    throw new ClientVisibleError('A role with this name already exists.');
  }
  const now = new Date();
  const permissions = validatePermissions([...(input.permissions ?? [])], actor);
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

export async function updateRole(id: string, patch: UpdateRoleInput, actor: RoleActor | undefined = requestActor()): Promise<void> {
  const values: Partial<Role> = {};
  const current = await Role.findOne({ where: { id } });
  if (!current) throw new ClientVisibleError('Role not found.');
  // The admin role holds everything and stays as it is: changing it could lock everyone out.
  if (current.name === ADMIN_ROLE) throw new ClientVisibleError('The admin role cannot be changed.');
  if (patch.name === ADMIN_ROLE) throw new ClientVisibleError('admin is the administrators\' role; choose another name.');
  // Nobody weakens or renames a role that holds permissions they lack.
  if (actor && !holdsAll(permissionsOf(actor), current.permissions ?? [])) throw new ClientVisibleError('This role has permissions you do not have, so you cannot change it.');
  if (patch.name !== undefined) {
    if (await Role.exists({ id: Not(id), name: patch.name })) {
      throw new ClientVisibleError('A role with this name already exists.');
    }
    values.name = patch.name;
  }
  if (patch.permissions !== undefined) {
    values.permissions = validatePermissions([...patch.permissions], actor);
  }
  if (Object.keys(values).length) await Role.update({ id }, values);
}

/** The admin role, found by its stored name: deleting it would lock everyone out of these screens. */
export async function deleteRole(id: string): Promise<void> {
  const role = await Role.findOne({ where: { id } });
  if (!role) throw new ClientVisibleError('Role not found.');
  if (role.name === ADMIN_ROLE) throw new ClientVisibleError('The admin role cannot be deleted.');
  await UserRole.delete({ roleId: id });
  await Role.delete({ id });
}
