import { ClientVisibleError } from '@cossackframework/core';
import { isCmsError } from '@cossackframework/cms';
import type { CmsRole } from '@cossackframework/cms/server';
import { currentCms } from '../cms/index';
import type { Permission } from '../lib/permissions';

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

function detail(role: CmsRole): RoleDetail {
  return { id: role.id, name: role.name, permissions: [...role.permissions], createdAt: new Date(role.createdAt).toISOString(),
    ...(role.userCount === undefined ? {} : { userCount: role.userCount }) };
}

async function visible<T>(work: Promise<T>): Promise<T> {
  try { return await work; }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
}

export async function listRoles(): Promise<RoleDetail[]>;
export async function listRoles(options: ListRolesOptions): Promise<ListRolesResult>;
export async function listRoles(options: ListRolesOptions = {}): Promise<RoleDetail[] | ListRolesResult> {
  const users = currentCms().users;
  if (options.page === undefined && options.pageSize === undefined && options.search === undefined) return (await users.roles()).map(detail);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(Math.max(1, options.pageSize ?? 20), 200);
  const [items, total] = await Promise.all([users.roles({ search: options.search, limit: pageSize, offset: (page - 1) * pageSize }), users.countRoles({ search: options.search })]);
  return { items: items.map(detail), total, page, pageSize };
}

/** The role new accounts get: General settings' default role, when it exists. */
export async function defaultRole(): Promise<RoleDetail | null> {
  const cms = currentCms();
  const id = await cms.settings.get('general.defaultRole');
  const role = id ? await cms.users.role(id) : null;
  return role ? detail(role) : null;
}

export async function getRole(id: string): Promise<RoleDetail | null> {
  const role = await currentCms().users.role(id);
  return role ? detail(role) : null;
}

export async function createRole(input: CreateRoleInput): Promise<RoleDetail> {
  return detail(await visible(currentCms().users.createRole({ name: input.name, permissions: input.permissions ?? [] })));
}

export async function updateRole(id: string, patch: UpdateRoleInput): Promise<void> {
  if (!(await visible(currentCms().users.updateRole(id, patch)))) throw new ClientVisibleError('Role not found.');
}

/** The administrator role cannot be deleted. Its holders keep their other roles. */
export async function deleteRole(id: string): Promise<void> {
  await visible(currentCms().users.deleteRole(id));
}
