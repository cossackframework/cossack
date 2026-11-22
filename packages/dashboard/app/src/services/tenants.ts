// Tenants: the list, their domains and their members. Rows are in the main database; a
// tenant's roles and member rows are in its own. See src/tenants.ts for the two scopes.
import { ClientVisibleError, getRequestContext } from '@cossackframework/core';
import { TENANT_DATABASE } from '@cossackframework/database';
import { uuidv7 } from '../lib/uuid';
import { accounts, currentTenant, forgetTenantHosts, inTenant, mainHost, RESERVED_SLUGS, TENANT_SLUG, tenantsEnabled, withTenant, type TenantInfo } from '../tenants';
import { Tenant } from '@/models/Tenant';
import { TenantDomain } from '@/models/TenantDomain';
import { TenantMember } from '@/models/TenantMember';
import { User } from '@/models/User';
import { Role } from '@/models/Role';
import { UserRole } from '@/models/UserRole';

export interface TenantSummary extends TenantInfo {
  readonly createdAt: string;
  readonly members: number;
  readonly domains: string[];
}

export interface TenantMemberSummary {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: string[];
}

const HOST = /^(?=.{1,191}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Tenants are managed on the main host, by network administrators. A seeder or a command has no request and may. */
function required(): void {
  if (!tenantsEnabled) throw new ClientVisibleError('Tenants are not turned on (src/dashboard.config.ts).');
  if (currentTenant()) throw new ClientVisibleError('Tenants are managed on the main host.');
  const c = getRequestContext();
  if (c && (c.get('user' as never) as { networkAdmin?: boolean } | undefined)?.networkAdmin !== true) throw new ClientVisibleError('Only a network administrator manages tenants.');
}

export interface NetworkAdminSummary { readonly id: string; readonly email: string; readonly name: string }

/** The accounts that reach every tenant. */
export async function listNetworkAdmins(): Promise<NetworkAdminSummary[]> {
  required();
  return (await User.find({ where: { networkAdmin: true }, order: { email: 'asc' }, take: 500 })).map(user => ({ id: user.id, email: user.email, name: user.name ?? '' }));
}

/** Make the account with this email a network administrator, or stop it being one. The last active one stays. */
export async function setNetworkAdmin(email: string, admin: boolean): Promise<void> {
  required();
  const account = await User.findOne({ where: { email: email.trim().toLowerCase() } });
  if (!account) throw new ClientVisibleError('No account has this email.');
  if (!admin) await requireAnotherNetworkAdmin(account.id, 'left without the role');
  await User.update({ id: account.id }, { networkAdmin: admin });
}

/** In the main database: refuse a change that would leave no active network administrator. */
export async function requireAnotherNetworkAdmin(userId: string, change: string): Promise<void> {
  const account = await User.findOne({ where: { id: userId } });
  if (!account?.networkAdmin) return;
  const others = (await User.find({ where: { networkAdmin: true, status: 'active' }, take: 2 })).filter(user => user.id !== userId);
  if (!others.length) throw new ClientVisibleError(`The last network administrator cannot be ${change}.`);
}

function info(row: Tenant): TenantInfo {
  return { id: row.id, slug: row.slug, name: row.name, database: row.database, status: row.status };
}

/** Every tenant, newest first, with its member count and domains. */
export async function listTenants(): Promise<TenantSummary[]> {
  required();
  const [rows, members, domains] = await Promise.all([
    Tenant.find({ order: { createdAt: 'desc' }, take: 500 }),
    TenantMember.find({ take: 20_000 }),
    TenantDomain.find({ take: 5000 }),
  ]);
  return rows.map(row => ({
    ...info(row),
    createdAt: row.createdAt.toISOString(),
    members: members.filter(member => member.tenantId === row.id).length,
    domains: domains.filter(domain => domain.tenantId === row.id).map(domain => domain.host).sort(),
  }));
}

export async function getTenant(id: string): Promise<TenantInfo | null> {
  required();
  const row = await Tenant.findOne({ where: { id } });
  return row ? info(row) : null;
}

/**
 * Make a tenant: its row, its database (created or opened, with every migration), the main
 * tenant's roles copied into it, and the creator as its administrator. A tenant that failed
 * half-way stays `creating` and unreachable; creating it again with the same slug finishes it.
 */
export async function createTenant(input: { name: string; slug: string }, creator: { id: string }): Promise<TenantInfo> {
  required();
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!name || name.length > 120) throw new ClientVisibleError('Give the tenant a name of at most 120 characters.');
  if (!TENANT_SLUG.test(slug) || RESERVED_SLUGS.includes(slug)) throw new ClientVisibleError('The address is lowercase letters, digits and hyphens, and not a reserved word.');
  const database = slug.replaceAll('-', '_');
  if (!TENANT_DATABASE.test(database)) throw new ClientVisibleError('The address is too long.');
  let row = await Tenant.findOne({ where: { slug } });
  if (row && row.status !== 'creating') throw new ClientVisibleError('A tenant with this address already exists.');
  if (!row) {
    const id = uuidv7();
    await Tenant.insert({ id, slug, name, database, status: 'creating', createdAt: new Date() });
    row = (await Tenant.findOne({ where: { id } }))!;
  }
  const tenant = info(row);
  const roles = await Role.find({ take: 500 });
  try {
    await withTenant(tenant, async () => {
      // Opening the database applied the migrations. The main tenant's roles are its first roles.
      const known = new Set((await Role.find({ take: 500 })).map(role => role.name));
      const missing = roles.filter(role => !known.has(role.name));
      if (missing.length) await Role.insert(missing.map(role => ({ id: role.id, name: role.name, permissions: role.permissions, createdAt: new Date() })));
    });
  } catch (error) {
    console.error(`[tenants] could not prepare the database of ${slug}`, error);
    throw new ClientVisibleError(`The tenant's database could not be opened: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  await addMemberById(tenant, creator.id, ['admin']);
  await Tenant.update({ id: tenant.id }, { status: 'active' });
  forgetTenantHosts();
  return { ...tenant, status: 'active' };
}

/** Archive a tenant (its hosts answer 503, its data stays) or bring it back. */
export async function setTenantStatus(id: string, status: 'active' | 'archived'): Promise<void> {
  required();
  const row = await Tenant.findOne({ where: { id } });
  if (!row || row.status === 'creating') throw new ClientVisibleError('Tenant not found.');
  await Tenant.update({ id }, { status });
  forgetTenantHosts();
}

/** Give a tenant a host name of its own. The name must point at this application. */
export async function addTenantDomain(id: string, host: string): Promise<void> {
  required();
  const name = host.trim().toLowerCase().replace(/\.$/, '');
  const main = mainHost();
  if (!HOST.test(name)) throw new ClientVisibleError('Enter a host name, such as app.example.com.');
  if (main && (name === main || name.endsWith(`.${main}`))) throw new ClientVisibleError(`Names under ${main} are tenants' own addresses.`);
  if (!await Tenant.exists({ id })) throw new ClientVisibleError('Tenant not found.');
  if (await TenantDomain.exists({ host: name })) throw new ClientVisibleError('This host name is already in use.');
  await TenantDomain.insert({ host: name, tenantId: id, createdAt: new Date() });
  forgetTenantHosts();
}

export async function removeTenantDomain(id: string, host: string): Promise<void> {
  required();
  await TenantDomain.delete({ host, tenantId: id });
  forgetTenantHosts();
}

/**
 * Make an account a member of a tenant: a member row under the account's ID in the tenant's
 * database (email and name copied, no password), its roles there, and the membership in the
 * main database. Call it in the main database's scope. Roles are given by name.
 */
export async function addMemberById(tenant: TenantInfo, userId: string, roleNames: readonly string[] = []): Promise<void> {
  const account = await User.findOne({ where: { id: userId } });
  if (!account) throw new ClientVisibleError('Account not found.');
  await withTenant(tenant, () => joinHere(account, roleNames));
  await TenantMember.upsert({ tenantId: tenant.id, userId, createdAt: new Date() }, ['tenantId', 'userId']);
}

/** In a tenant's scope: the member row and roles of an account. */
async function joinHere(account: User, roleNames: readonly string[]): Promise<void> {
  if (await User.exists({ id: account.id })) {
    await User.update({ id: account.id }, { email: account.email, name: account.name, avatar: account.avatar, status: 'active' });
  } else {
    await User.insert({ id: account.id, email: account.email, name: account.name, passwordHash: null, avatar: account.avatar, meta: null, status: 'active', createdAt: new Date() });
  }
  if (!roleNames.length) return;
  const roles = (await Role.find({ take: 500 })).filter(role => roleNames.includes(role.name));
  for (const role of roles) await UserRole.upsert({ userId: account.id, roleId: role.id, createdAt: new Date() }, ['userId', 'roleId']);
}

/** Add the account with this email to a tenant, from the main host's Tenants screen. */
export async function addTenantMember(id: string, email: string, roleNames: readonly string[] = []): Promise<void> {
  required();
  const row = await Tenant.findOne({ where: { id } });
  if (!row) throw new ClientVisibleError('Tenant not found.');
  const account = await User.findOne({ where: { email: email.trim().toLowerCase() } });
  if (!account) throw new ClientVisibleError('No account has this email. The person registers first.');
  await addMemberById(info(row), account.id, roleNames);
}

export async function removeTenantMember(id: string, userId: string): Promise<void> {
  required();
  const row = await Tenant.findOne({ where: { id } });
  if (!row) throw new ClientVisibleError('Tenant not found.');
  await withTenant(info(row), leaveHere.bind(null, userId));
  await TenantMember.delete({ tenantId: id, userId });
}

/** In a tenant's scope: remove the member row and roles. */
async function leaveHere(userId: string): Promise<void> {
  await UserRole.delete({ userId });
  await User.delete({ id: userId });
}

/** A tenant's members with their roles there. */
export async function listTenantMembers(id: string): Promise<TenantMemberSummary[]> {
  required();
  const row = await Tenant.findOne({ where: { id } });
  if (!row) return [];
  return withTenant(info(row), async () => {
    const [users, assignments, roles] = await Promise.all([User.find({ order: { email: 'asc' }, take: 1000 }), UserRole.find({ take: 20_000 }), Role.find({ take: 500 })]);
    const names = new Map(roles.map(role => [role.id, role.name]));
    return users.map(user => ({ id: user.id, email: user.email, name: user.name ?? '',
      roles: assignments.filter(assignment => assignment.userId === user.id).map(assignment => names.get(assignment.roleId) ?? '').filter(Boolean).sort() }));
  });
}

// --- Inside a tenant's own request (its Users screen) -------------------------------------

/**
 * In a tenant's request: make the account with this email a member, creating the account when
 * there is none. An existing account keeps its password; `password` is for a new one.
 */
export async function joinCurrentTenant(input: { email: string; name?: string; passwordHash: string | null }): Promise<{ id: string; created: boolean }> {
  const tenant = currentTenant();
  if (!tenant) throw new Error('Not a tenant request.');
  const { account, created } = await accounts(async () => {
    const existing = await User.findOne({ where: { email: input.email } });
    if (existing) return { account: existing, created: false };
    if (!input.passwordHash) throw new ClientVisibleError('Set a password for the new account.');
    const id = uuidv7();
    await User.insert({ id, email: input.email, name: input.name ?? null, passwordHash: input.passwordHash, avatar: null, meta: null, status: 'active', createdAt: new Date() });
    return { account: (await User.findOne({ where: { id } }))!, created: true };
  });
  if (await inTenant(() => User.exists({ id: account.id }))) throw new ClientVisibleError('This account is already a member.');
  await inTenant(() => joinHere(account, []));
  await accounts(() => TenantMember.upsert({ tenantId: tenant.id, userId: account.id, createdAt: new Date() }, ['tenantId', 'userId']));
  return { id: account.id, created };
}

/** In a tenant's request: the account stops being a member. The account itself stays. */
export async function leaveCurrentTenant(userId: string): Promise<void> {
  const tenant = currentTenant();
  if (!tenant) throw new Error('Not a tenant request.');
  await inTenant(() => leaveHere(userId));
  await accounts(() => TenantMember.delete({ tenantId: tenant.id, userId }));
}

/** In the main database: forget an account's memberships, when the account is deleted. */
export async function forgetMemberships(userId: string): Promise<void> {
  await TenantMember.delete({ userId });
}

/** The tenants an account is a member of, for a switcher. */
export async function tenantsOf(userId: string): Promise<TenantInfo[]> {
  if (!tenantsEnabled) return [];
  return accounts(async () => {
    const memberships = await TenantMember.find({ where: { userId }, take: 500 });
    if (!memberships.length) return [];
    const ids = new Set(memberships.map(membership => membership.tenantId));
    return (await Tenant.find({ take: 500 })).filter(row => ids.has(row.id) && row.status === 'active').map(info);
  });
}
