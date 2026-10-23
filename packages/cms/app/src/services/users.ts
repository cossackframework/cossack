import { ClientVisibleError } from '@cossackframework/core';
import { isCmsError } from '@cossackframework/cms';
import type { CmsUser } from '@cossackframework/cms/server';
import { currentCms } from '../cms/index';
import type { PublicUser, RoleAssignment } from '../auth';

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  createdAt: string;
  /** When the user last signed in, recorded when a session starts; null when never. */
  lastSignedInAt: string | null;
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
  /** Roles chosen by someone who may assign them; otherwise the default role. */
  roleIds?: string[];
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  avatar?: string | null;
}

function summary(user: CmsUser): UserSummary {
  return {
    id: user.id, email: user.email, name: user.name, avatar: user.avatar, createdAt: new Date(user.createdAt).toISOString(),
    lastSignedInAt: user.lastSignInAt === null ? null : new Date(user.lastSignInAt).toISOString(),
    roles: user.assignments.map(role => ({ id: role.id, name: role.name, permissions: [...role.permissions] })),
  };
}

/** CMS failures carry safe text; pages show it. */
async function visible<T>(work: Promise<T>): Promise<T> {
  try { return await work; }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
}

export async function listUsers(options: ListUsersOptions = {}): Promise<ListUsersResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(Math.max(1, options.pageSize ?? 20), 100);
  const result = await currentCms().users.list({ search: options.search, role: options.roleId, limit: pageSize, offset: (page - 1) * pageSize });
  return { items: result.items.map(summary), total: result.total, page, pageSize };
}

export async function getUser(id: string): Promise<UserDetail | null> {
  const user = await currentCms().users.get(id);
  return user ? summary(user) : null;
}

/** A new account with the chosen roles, or General settings' default role. */
export async function createUser(input: CreateUserInput): Promise<Omit<PublicUser, 'principal'>> {
  const cms = currentCms();
  let roles: string[];
  if (input.roleIds) {
    roles = [...new Set(input.roleIds)];
    for (const id of roles) if (!(await cms.users.role(id))) throw new ClientVisibleError('Choose roles that exist.');
  } else {
    const role = await cms.settings.get('general.defaultRole');
    roles = role && (await cms.users.role(role)) ? [role] : [];
  }
  const user = await visible(cms.users.create({ email: input.email, password: input.password, name: input.name?.trim() || input.email.split('@')[0]!, roles }));
  return { ...summary(user), meta: null };
}

export async function updateUser(id: string, patch: UpdateUserInput): Promise<void> {
  await visible(currentCms().users.update(id, patch));
}

export async function changeUserPassword(id: string, newPassword: string): Promise<void> {
  if (!(await visible(currentCms().users.setPassword(id, newPassword)))) throw new ClientVisibleError('User not found.');
}

/** Removes the account with its roles and sessions. Content keeps its author ID. */
export async function deleteUser(id: string): Promise<void> {
  await visible(currentCms().users.delete(id));
}

export async function assignRole(userId: string, roleId: string): Promise<void> {
  const user = await currentCms().users.get(userId);
  if (user) await syncUserRoles(userId, [...new Set([...user.roles, roleId])]);
}

export async function removeRole(userId: string, roleId: string): Promise<void> {
  const user = await currentCms().users.get(userId);
  if (user) await syncUserRoles(userId, user.roles.filter(role => role !== roleId));
}

export async function syncUserRoles(userId: string, roleIds: string[]): Promise<void> {
  await visible(currentCms().users.setRoles(userId, roleIds));
}
