import { ClientVisibleError, getRequestContext } from '@cossackframework/core';
import { isCmsError, systemPrincipal } from '@cossackframework/cms';
import { MAIN_SITE, type CmsUser } from '@cossackframework/cms/server';
import { currentCms, networkFor, type CmsBindings } from '../cms/index';
import { manageableHere, NETWORK_ACCOUNT_LOCKED, type PublicUser, type RoleAssignment } from '../auth';

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  createdAt: string;
  /** When the user last signed in, recorded when a session starts; null when never. */
  lastSignedInAt: string | null;
  roles: RoleAssignment[];
  /** On an added site, *Network account* for members who sign in through the network. */
  badge?: string;
}

export interface UserDetail extends UserSummary {
  /** For others on an added site, why a network account's profile, password and sign-in methods are not changed here. */
  lockedProfile?: string;
}

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
    // Site accounts are an added site's own; members with a network account are marked.
    ...(currentCms().siteAccounts && user.account === 'network' ? { badge: 'Network account' } : {}),
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
  if (!user) return null;
  return { ...summary(user), ...(await manageableHere(id) ? {} : { lockedProfile: NETWORK_ACCOUNT_LOCKED }) };
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

/** A network account on an added site keeps its name, email and picture unless the person or a network admin changes them. */
export async function updateUser(id: string, patch: UpdateUserInput): Promise<void> {
  const cms = currentCms();
  if (!(await manageableHere(id))) {
    const user = await cms.users.get(id);
    if (user && (Object.keys(patch) as (keyof UpdateUserInput)[]).some(key => patch[key] !== undefined && patch[key] !== user[key])) throw new ClientVisibleError(NETWORK_ACCOUNT_LOCKED);
    return;
  }
  await visible(cms.users.update(id, patch));
}

export async function changeUserPassword(id: string, newPassword: string): Promise<void> {
  if (!(await manageableHere(id))) throw new ClientVisibleError(NETWORK_ACCOUNT_LOCKED);
  if (!(await visible(currentCms().users.setPassword(id, newPassword)))) throw new ClientVisibleError('User not found.');
}

/**
 * On the main site, deletes the account: from every site it belongs to, then what signs it in.
 * On another site, removes the member and their roles: a site account goes with them, a network
 * account stays. Content keeps its author ID. The last network admin cannot be deleted.
 */
export async function deleteUser(id: string): Promise<void> {
  const c = getRequestContext();
  const cms = currentCms();
  if (c?.get('site')?.id && c.get('site').id !== MAIN_SITE) { await visible(cms.users.delete(id)); return; }
  await visible(networkFor(c!.env as CmsBindings).deleteAccount(id, { principal: systemPrincipal('users') }));
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
