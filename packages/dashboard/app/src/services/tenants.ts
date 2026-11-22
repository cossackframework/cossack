// Tenants: the list, their domains and their members. Rows are in the main database; a
// tenant's roles and member rows are in its own. See src/tenants.ts for the two scopes.
import { ClientVisibleError, getRequestContext } from '@cossackframework/core';
import { sql, TENANT_DATABASE } from '@cossackframework/database';
import { uuidv7 } from '../lib/uuid';
import { accounts, asMainAccount, currentTenant, forgetTenantHosts, inTenant, mainHost, RESERVED_SLUGS, setTenantRegistrationOn, setTenantsRunning, TENANT_SLUG, tenantRegistrationOn, tenantsEnabled, tenantsRunning, withTenant, type TenantInfo } from '../tenants';
import * as security from './security';
import { authOptions } from '../auth-options';
import { Tenant } from '@/models/Tenant';
import { TenantDomain } from '@/models/TenantDomain';
import { TenantMember } from '@/models/TenantMember';
import { User } from '@/models/User';
import { Role } from '@/models/Role';
import { UserRole } from '@/models/UserRole';
import { UserSecurity } from '@/models/UserSecurity';
import { Passkey } from '@/models/Passkey';
import { ApiToken } from '@/models/ApiToken';

export interface TenantSummary extends TenantInfo {
  readonly createdAt: string;
  readonly members: number;
  readonly domains: TenantDomainSummary[];
  /** When a deleted tenant is purged. */
  readonly purgedAt?: string;
}

export interface TenantDomainSummary { readonly host: string; readonly primary: boolean; readonly verified: boolean }

/** How long a deleted tenant can be restored. */
export const TENANT_PURGE_MS = 30 * 24 * 60 * 60 * 1000;

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
  const primaryOf = (id: string) => domains.find(domain => domain.tenantId === id && domain.isPrimary && domain.verifiedAt)?.host;
  return rows.map(row => ({
    ...info(row),
    ...(primaryOf(row.id) ? { primaryHost: primaryOf(row.id)! } : {}),
    createdAt: row.createdAt.toISOString(),
    members: members.filter(member => member.tenantId === row.id).length,
    domains: domains.filter(domain => domain.tenantId === row.id).map(domain => ({ host: domain.host, primary: domain.isPrimary, verified: domain.verifiedAt !== null }))
      .sort((a, b) => a.host < b.host ? -1 : 1),
    ...(row.status === 'deleted' && row.deletedAt ? { purgedAt: new Date(row.deletedAt.getTime() + TENANT_PURGE_MS).toISOString() } : {}),
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
  return makeTenant(input, creator);
}

/** How many tenants one account registers in a day. */
export const TENANT_REGISTRATIONS = Object.freeze({ max: 3, windowMs: 24 * 60 * 60 * 1000 });

/** Whether signed-in accounts make tenants of their own, on the main host. A network administrator turns it on. */
export async function tenantRegistrationOpen(): Promise<boolean> {
  return tenantsEnabled && !currentTenant() && await tenantsRunning() && await tenantRegistrationOn();
}

export async function setTenantRegistration(on: boolean): Promise<void> {
  required();
  await setTenantRegistrationOn(on);
}

/**
 * A signed-in main account makes a tenant of its own and is its administrator. It needs the
 * network's registration setting; an account registers at most three a day.
 */
export async function registerTenant(input: { name: string; slug: string }, user: { id: string }): Promise<TenantInfo> {
  if (!await tenantRegistrationOpen()) throw new ClientVisibleError('Registration of tenants is closed.');
  if (!await security.attempt('tenant-registration', `u:${user.id}`, TENANT_REGISTRATIONS.max, TENANT_REGISTRATIONS.windowMs)) throw new ClientVisibleError('You registered three tenants today. Try again tomorrow.');
  return makeTenant(input, user);
}

async function makeTenant(input: { name: string; slug: string }, creator: { id: string }): Promise<TenantInfo> {
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

/**
 * Archive a tenant (its hosts answer 503, its data stays), delete it (its hosts answer 404; it
 * can be restored for 30 days) or bring it back.
 */
export async function setTenantStatus(id: string, status: 'active' | 'archived' | 'deleted'): Promise<void> {
  required();
  const row = await Tenant.findOne({ where: { id } });
  if (!row || row.status === 'creating') throw new ClientVisibleError('Tenant not found.');
  await Tenant.update({ id }, { status, deletedAt: status === 'deleted' ? new Date() : null });
  forgetTenantHosts();
}

/**
 * Forget the tenants that were deleted more than 30 days ago: their rows, domains and
 * memberships. Their databases are not dropped here: a file or a database is yours to remove.
 * Returns what was purged, so a schedule or a script can remove each database.
 */
export async function purgeDeletedTenants(now = Date.now()): Promise<TenantInfo[]> {
  const due = (await Tenant.find({ where: { status: 'deleted' }, take: 500 })).filter(row => row.deletedAt && row.deletedAt.getTime() + TENANT_PURGE_MS <= now);
  for (const row of due) {
    await TenantMember.delete({ tenantId: row.id });
    await TenantDomain.delete({ tenantId: row.id });
    await Tenant.delete({ id: row.id, status: 'deleted' });
  }
  if (due.length) forgetTenantHosts();
  return due.map(info);
}

/** Whether tenants' hosts answer (the Tenants screen's switch). */
export async function networkRunning(): Promise<boolean> {
  required();
  return tenantsRunning();
}

export async function setNetworkRunning(on: boolean): Promise<void> {
  required();
  await setTenantsRunning(on);
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
  // Without verification (src/dashboard.config.ts), a network administrator's word is enough.
  await TenantDomain.insert({ host: name, tenantId: id, isPrimary: false, verifiedAt: authOptions.tenants.verifyDomains ? null : new Date(), createdAt: new Date() });
  forgetTenantHosts();
}

/**
 * Check that a domain points at this application: it must answer
 * `/.well-known/cossack-tenant` with the tenant's ID, which this application does for every
 * host a tenant asked for. The domain reaches the tenant from then on.
 */
export async function verifyTenantDomain(id: string, host: string): Promise<void> {
  required();
  const domain = await TenantDomain.findOne({ where: { host, tenantId: id } });
  if (!domain) throw new ClientVisibleError('Domain not found.');
  if (domain.verifiedAt) return;
  const base = new URL(env('APP_URL', '') || 'https://localhost');
  let answer = '';
  try {
    const response = await fetch(`${base.protocol}//${host}${base.port ? `:${base.port}` : ''}/.well-known/cossack-tenant`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    answer = response.ok ? (await response.text()).trim().slice(0, 200) : '';
  } catch { /* unreachable: not verified */ }
  if (answer !== id) throw new ClientVisibleError(`${host} does not point at this application yet. Point its DNS here and try again.`);
  await TenantDomain.update({ host, tenantId: id }, { verifiedAt: new Date() });
  forgetTenantHosts();
}

/** Make a verified domain the tenant's address (its other hosts redirect there), or none with an empty host. */
export async function setPrimaryTenantDomain(id: string, host: string): Promise<void> {
  required();
  if (host) {
    const domain = await TenantDomain.findOne({ where: { host, tenantId: id } });
    if (!domain) throw new ClientVisibleError('Domain not found.');
    if (!domain.verifiedAt) throw new ClientVisibleError('Verify the domain before making it the primary one.');
  }
  await TenantDomain.update({ tenantId: id }, { isPrimary: false });
  if (host) await TenantDomain.update({ host, tenantId: id }, { isPrimary: true });
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
 * main database. Call it in the main database's scope. Roles are given by ID.
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
  const roles = (await Role.find({ take: 500 })).filter(role => roleNames.includes(role.id));
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
  if (await inTenant(() => User.exists({ email: input.email }))) throw new ClientVisibleError('An account with this email is already here.');
  // The main account with this email becomes a member. Without one, the new account is this tenant's own.
  const account = await asMainAccount(() => accounts(() => User.findOne({ where: { email: input.email } })));
  if (!account) {
    if (!input.passwordHash) throw new ClientVisibleError('Set a password for the new account.');
    const id = uuidv7();
    await inTenant(() => User.insert({ id, email: input.email, name: input.name ?? null, passwordHash: input.passwordHash, avatar: null, meta: null, status: 'active', tenantAccount: true, createdAt: new Date() }));
    return { id, created: true };
  }
  await inTenant(() => joinHere(account, []));
  await asMainAccount(() => accounts(() => TenantMember.upsert({ tenantId: tenant.id, userId: account.id, createdAt: new Date() }, ['tenantId', 'userId'])));
  return { id: account.id, created: false };
}

/** In a tenant's request: whether the user is an account of this tenant only (not a member with a main account). */
export async function tenantOwnAccount(userId: string): Promise<boolean> {
  if (!currentTenant()) return false;
  return inTenant(async () => (await User.findOne({ where: { id: userId } }))?.tenantAccount === true);
}

/** In a tenant's request: the account stops being a member. The account itself stays. */
export async function leaveCurrentTenant(userId: string): Promise<void> {
  const tenant = currentTenant();
  if (!tenant) throw new Error('Not a tenant request.');
  await inTenant(async () => { await sql`DELETE FROM sessions WHERE user_id = ${userId}`; await leaveHere(userId); });
  await asMainAccount(() => accounts(() => TenantMember.delete({ tenantId: tenant.id, userId })));
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

/** The rows of an account that move with it: its authenticator app and recovery codes. */
async function takeSecurity(userId: string): Promise<UserSecurity | null> {
  const row = await UserSecurity.findOne({ where: { userId } });
  if (row) await UserSecurity.delete({ userId });
  // Passkeys belong to the host they were made on, and application passwords name the account's home: both are set up again.
  await Passkey.delete({ userId });
  await ApiToken.delete({ userId });
  return row;
}

async function giveSecurity(row: UserSecurity | null): Promise<void> {
  if (row) await UserSecurity.insert({ userId: row.userId, totpSecret: row.totpSecret, totpConfirmedAt: row.totpConfirmedAt, totpLastStep: row.totpLastStep, recovery: row.recovery, updatedAt: new Date() });
}

/**
 * Move an account between a tenant and the main database, keeping its ID, password and
 * authenticator app. `main`: an account of this tenant only becomes one every tenant can have
 * as a member, and stays a member here. `tenant`: a main account that is a member of this
 * tenant only, and no network administrator, becomes this tenant's own. Its sessions end, and
 * it sets up passkeys and application passwords again. Call it in the main database's scope.
 */
export async function moveAccount(tenant: TenantInfo, userId: string, to: 'main' | 'tenant'): Promise<void> {
  required();
  const here = await withTenant(tenant, () => User.findOne({ where: { id: userId } }));
  if (!here) throw new ClientVisibleError('This tenant has no such user.');
  if (to === 'main') {
    if (!here.tenantAccount) throw new ClientVisibleError('This is a shared account already.');
    if (await User.exists({ email: here.email })) throw new ClientVisibleError('Another shared account has this email.');
    const security = await withTenant(tenant, async () => {
      await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
      const row = await takeSecurity(userId);
      await User.update({ id: userId }, { tenantAccount: false, passwordHash: null });
      return row;
    });
    await User.insert({ id: here.id, email: here.email, name: here.name, passwordHash: here.passwordHash, avatar: here.avatar, meta: here.meta, status: here.status, createdAt: here.createdAt });
    await giveSecurity(security);
    await TenantMember.upsert({ tenantId: tenant.id, userId, createdAt: new Date() }, ['tenantId', 'userId']);
    return;
  }
  if (here.tenantAccount) throw new ClientVisibleError('This is an account of this tenant already.');
  const account = await User.findOne({ where: { id: userId } });
  if (!account) throw new ClientVisibleError('Account not found.');
  if (account.networkAdmin) throw new ClientVisibleError('A network administrator keeps a shared account.');
  if ((await TenantMember.find({ where: { userId }, take: 3 })).some(member => member.tenantId !== tenant.id)) throw new ClientVisibleError('This account is a member of other tenants too.');
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
  const security = await takeSecurity(userId);
  await UserRole.delete({ userId });
  await TenantMember.delete({ userId });
  await User.delete({ id: userId });
  await withTenant(tenant, async () => {
    await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
    await User.update({ id: userId }, { tenantAccount: true, passwordHash: account.passwordHash, email: account.email, name: account.name, status: account.status });
    await giveSecurity(security);
  });
}
