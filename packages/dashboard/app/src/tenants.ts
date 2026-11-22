// Tenants (src/dashboard.config.ts: `tenants`). Each tenant has its own database; accounts,
// sessions and the list of tenants are in the application's own ("main") database.
//
// A request for a tenant's host runs in that tenant's ORM scope, so models and services reach
// the tenant's database. Account code steps back to the main database with `accounts()`.
// With tenants off, or on the main host, both are the same database and these do nothing.
import { tenantORM } from '@/orm/factory';
import type { Context } from 'hono';
import type { ORM } from '@cossackframework/database';
import { getRequestContext } from '@cossackframework/core';
import { authOptions } from './auth-options';
import { Tenant } from '@/models/Tenant';
import { TenantDomain } from '@/models/TenantDomain';
import { TenantNetwork } from '@/models/TenantNetwork';

/** The tenant a request is for. */
export interface TenantInfo {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly database: string;
  readonly status: 'creating' | 'active' | 'archived' | 'deleted';
  /** The tenant's primary domain, when it has one: its other hosts redirect there. */
  readonly primaryHost?: string;
}

const TENANT = 'tenant';
const MAIN_ORM = 'tenant:main-orm';
const TENANT_ORM = 'tenant:orm';

export const tenantsEnabled = authOptions.tenants.enabled;
export const sharedSignIn = tenantsEnabled && authOptions.tenants.signIn === 'shared';

/** A tenant's slug: a DNS label. `www`, `main` and `new` are not tenants. */
export const TENANT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const RESERVED_SLUGS: readonly string[] = ['www', 'main', 'new', 'app', 'api', 'admin'];

/** A request's host name: lowercase, without the port. */
export function hostName(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** The main host, from APP_URL. Without APP_URL every request is the main tenant's. */
export function mainHost(): string {
  return hostName(env('APP_URL', ''));
}

/** The tenant of this request, or null on the main host (and with tenants off). */
export function currentTenant(c: Context | undefined = getRequestContext()): TenantInfo | null {
  return (c?.get(TENANT as never) as TenantInfo | undefined) ?? null;
}

/**
 * Run account code against the main database: accounts, sessions, second factors, tokens,
 * the list of tenants. Inside a tenant's request it steps out of the tenant's database.
 */
export function accounts<T>(work: () => Promise<T>): Promise<T> {
  const main = getRequestContext()?.get(MAIN_ORM as never) as ORM | undefined;
  return main ? main.run(work) : work();
}

/** Run code against the request's tenant database again, from inside `accounts()`. */
export function inTenant<T>(work: () => Promise<T>): Promise<T> {
  const orm = getRequestContext()?.get(TENANT_ORM as never) as ORM | undefined;
  return orm ? orm.run(work) : work();
}

/** Run code against one tenant's database, whatever the request's host: the main host's Tenants screen uses it. */
export async function withTenant<T>(tenant: Pick<TenantInfo, 'database' | 'slug'>, work: () => Promise<T>): Promise<T> {
  const c = getRequestContext();
  const opened = await tenantORM(c?.env, tenant);
  const before = c ? [c.get(MAIN_ORM as never), c.get(TENANT_ORM as never)] as const : undefined;
  try {
    // `accounts()` inside the work still reaches the main database.
    if (c && !before![0]) c.set(MAIN_ORM as never, c.get('orm' as never));
    c?.set(TENANT_ORM as never, opened.orm as never);
    return await opened.orm.run(work);
  } finally {
    if (c) { c.set(MAIN_ORM as never, before![0] as never); c.set(TENANT_ORM as never, before![1] as never); }
    await opened.release();
  }
}

function info(row: Tenant, primaryHost?: string): TenantInfo {
  return { id: row.id, slug: row.slug, name: row.name, database: row.database, status: row.status, ...(primaryHost ? { primaryHost } : {}) };
}

// Whether the network of tenants runs: a setting in the main database, remembered for half a minute.
let running: { at: number; value: boolean } | undefined;

/** Whether tenants' hosts answer. A network administrator turns the network off and on; off, only the main host answers. Called in the main database's scope. */
export async function tenantsRunning(): Promise<boolean> {
  if (!tenantsEnabled) return false;
  if (running && Date.now() - running.at < LOOKUP_MS) return running.value;
  const row = await TenantNetwork.findOne({ where: { key: 'enabled' } });
  running = { at: Date.now(), value: row?.value !== 'false' };
  return running.value;
}

/** Turn the network of tenants on or off. Tenants keep their data while it is off. */
export async function setTenantsRunning(on: boolean): Promise<void> {
  await TenantNetwork.upsert({ key: 'enabled', value: on ? 'true' : 'false', updatedAt: new Date() }, ['key']);
  running = undefined;
  forgetTenantHosts();
}

/** The tenant that asked for this host as a domain, verified or not: its ID answers `/.well-known/cossack-tenant`. */
export async function tenantClaimingHost(host: string): Promise<string | null> {
  return (await TenantDomain.findOne({ where: { host } }))?.tenantId ?? null;
}

// Which tenant a host is, remembered for half a minute.
const lookups = new Map<string, { at: number; tenant: TenantInfo | null }>();
const LOOKUP_MS = 30_000;

/** Forget remembered hosts, after a tenant or a domain changed. Other servers follow within half a minute. */
export function forgetTenantHosts(): void {
  lookups.clear();
}

/** The tenant a host name reaches: `<slug>.<main host>` or one of its domains. Called in the main database's scope. */
export async function tenantOfHost(host: string, main = mainHost()): Promise<TenantInfo | null> {
  const known = lookups.get(host);
  if (known && Date.now() - known.at < LOOKUP_MS) return known.tenant;
  let row: Tenant | null = null;
  if (main && host.endsWith(`.${main}`)) {
    const slug = host.slice(0, -main.length - 1);
    if (TENANT_SLUG.test(slug)) row = await Tenant.findOne({ where: { slug } });
  }
  if (!row) {
    const domain = await TenantDomain.findOne({ where: { host } });
    // A domain reaches its tenant once it was verified.
    if (domain?.verifiedAt) row = await Tenant.findOne({ where: { id: domain.tenantId } });
  }
  const primary = row ? await TenantDomain.findOne({ where: { tenantId: row.id, isPrimary: true } }) : null;
  const tenant = row ? info(row, primary?.verifiedAt ? primary.host : undefined) : null;
  if (lookups.size > 2000) lookups.clear();
  lookups.set(host, { at: Date.now(), tenant });
  return tenant;
}

/** The address of a tenant's host (or the main host for null), with APP_URL's scheme and port. */
export function tenantOrigin(tenant: Pick<TenantInfo, 'slug' | 'primaryHost'> | null): string | null {
  const configured = env('APP_URL', '');
  if (!configured) return null;
  const url = new URL(configured);
  if (tenant) url.hostname = tenant.primaryHost ?? `${tenant.slug}.${url.hostname}`;
  return url.origin;
}

/** @internal The middleware's marks on the request. */
export function markTenantRequest(c: Context, tenant: TenantInfo, main: ORM, orm: ORM): void {
  c.set(TENANT as never, tenant as never);
  c.set(MAIN_ORM as never, main as never);
  c.set(TENANT_ORM as never, orm as never);
}
