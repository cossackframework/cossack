/**
 * A site's users and roles on relational host tables. Each user is a member: an account, with
 * the account's name, email, avatar and status copied in, and the site's own roles, slug and
 * profile fields. Sign-in and passwords are the account's. The account is a network account
 * (see accounts.ts), or on an added site a site account, in the site's own database.
 */
import { ClientError, type RomeDB, type Statement, type Value } from '@cossackframework/romedb';
import { CmsError, isCmsError } from '../errors';
import { SYSTEM_META } from '../field-groups';
import { slugify } from '../fields';
import { holdsAll, NETWORK_ADMIN, userPrincipal, type Principal } from '../permissions';
import { parseMeta, type MetaCheck } from './taxonomies';
import { ACCOUNT_ID, normalizeEmail, type AccountProfile, type CmsAccount, type CmsAccounts } from './accounts';
import { MAIN_SITE } from './sites';
import { readByIds } from './budget';

export interface CmsUser {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly avatar: string | null;
    readonly status: 'active' | 'disabled';
    /** Role IDs, such as `admin`. */
    readonly roles: readonly string[];
    /** Each role with its name and permissions, in ID order. */
    readonly assignments: readonly { readonly id: string; readonly name: string; readonly permissions: readonly string[] }[];
    /** Permissions of all roles together. */
    readonly permissions: readonly string[];
    readonly createdAt: number;
    /** When the user last started a session on this site, or null when never. */
    readonly lastSignInAt: number | null;
    /** Values of the field groups attached to users, and the author profile (`AUTHOR_FIELDS`). */
    readonly meta: { readonly [field: string]: unknown };
    /** The author page's slug, such as `ada-lovelace`; null until the user is saved or `withSlugs` runs. */
    readonly slug: string | null;
    /** `site`: an account of this site only, in its database. `network`: a network account. */
    readonly account: 'site' | 'network';
}

export interface CmsRole {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly string[];
    readonly createdAt: number;
    /** Users holding the role, when listed. */
    readonly userCount?: number;
}

export interface UserPage {
    readonly items: readonly CmsUser[];
    readonly total: number;
}

const ID = ACCOUNT_ID;
const PERMISSION = /^(?:\*|[a-z][a-z0-9:/._*-]{0,127})$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WRITE = { kind: 'cms.users', retryConflicts: 5 } as const;

/** `($p0, $p1, …)` with its parameters, for a bounded `IN` list. */
export function inList(prefix: string, values: readonly Value[]): { rql: string; params: { [key: string]: Value } } {
    const params: { [key: string]: Value } = {};
    values.forEach((value, index) => { params[`$${prefix}${index}`] = value; });
    return { rql: `(${values.map((_, index) => `$${prefix}${index}`).join(', ')})`, params };
}

/** A LIKE pattern matching `text` anywhere, with `%`, `_` and `\` escaped. Use with `ESCAPE '\\'`. */
export function containsPattern(text: string): string {
    return `%${text.toLowerCase().replace(/[\\%_]/g, character => `\\${character}`)}%`;
}

/** The request user: a member whose account is active, with the principal it acts as. */
export type CmsMember = CmsUser & { readonly principal: Principal };

/** The most users one `getMany` reads, and so the page size of `after`. */
const USERS_PER_READ = 200;

export class CmsUsers {
    readonly #db: RomeDB;
    readonly #accounts: CmsAccounts;
    readonly #siteAccounts: CmsAccounts | null;
    readonly #site: string;
    readonly #now: () => number;
    readonly #checkMeta: MetaCheck | undefined;

    /**
     * `accounts` are the network's; `siteAccounts`, on an added site, its own. `site` is this
     * site's ID in the network (default `main`), for the network's record of memberships.
     */
    constructor(db: RomeDB, options: { accounts: CmsAccounts; siteAccounts?: CmsAccounts; site?: string; now?: () => number; checkMeta?: MetaCheck }) {
        this.#db = db;
        this.#accounts = options.accounts;
        this.#siteAccounts = options.siteAccounts ?? null;
        this.#site = options.site ?? MAIN_SITE;
        this.#now = options.now ?? Date.now;
        this.#checkMeta = options.checkMeta;
    }

    /**
     * A new account that is a member of this site with these roles: a site account on an added
     * site, unless `network` asks for a network account, and a network account on the main site.
     */
    /**
     * Create an account and its membership. With `approval`, the account starts disabled and waits
     * for approval: its registrations row is written with its member row, so no failure leaves an
     * active account that skipped approval, or a disabled one missing from the queue.
     */
    async create(input: AccountProfile & { email: string; name: string; password?: string; roles?: readonly string[]; id?: string; meta?: unknown; networkRole?: typeof NETWORK_ADMIN; network?: boolean; status?: 'active' | 'disabled'; approval?: { verified: boolean } }): Promise<CmsUser> {
        const meta = await this.#meta(input.meta, null);
        for (const role of input.roles ?? []) if (!ID.test(role)) throw new CmsError('CMS_VALIDATION', `Invalid role ${role}.`);
        const store = input.network || !this.#siteAccounts ? this.#accounts : this.#siteAccounts;
        if (store === this.#siteAccounts && input.networkRole) throw new CmsError('CMS_VALIDATION', 'Network admins have network accounts.');
        // Members' emails are unique on a site, whichever kind their account is.
        if (await this.findByEmail(input.email).catch(() => null)) throw new CmsError('CMS_CONFLICT', 'An account with this email already exists.', { fields: { email: 'is taken.' } });
        const { network: _network, approval, ...profile } = input;
        const account = await store.create(approval ? { ...profile, status: 'disabled' } : profile);
        try { return await this.#join(account, input.roles ?? [], meta, store === this.#accounts, approval); }
        catch (error) {
            await store.delete(account.id).catch(() => undefined);
            throw error;
        }
    }

    /** Make an existing account a member of this site, with these roles. */
    async addMember(accountId: string, options: { roles?: readonly string[]; meta?: unknown } = {}): Promise<CmsUser | null> {
        const account = await this.#accounts.get(accountId);
        if (!account) return null;
        const existing = await this.get(accountId);
        if (existing) return existing;
        return this.#join(account, options.roles ?? [], await this.#meta(options.meta, null), true);
    }

    /** Copy the account in as a member with these roles. The network records the memberships of its own accounts. */
    async #join(account: CmsAccount, roles: readonly string[], meta: { readonly [field: string]: unknown }, network: boolean, approval?: { verified: boolean }): Promise<CmsUser> {
        const now = this.#now();
        const slug = await this.#freeSlug(account.name, account.id);
        try {
            await this.#db.write([{
                rql: 'INSERT INTO cms_users (id, email, name, avatar, status, created_at, updated_at, meta, slug) VALUES ($id, $email, $name, $avatar, $status, $now, $now, $meta, $slug)',
                params: { $id: account.id, $email: account.email, $name: account.name, $avatar: account.avatar, $status: approval ? 'disabled' : account.status, $now: now, $meta: JSON.stringify(meta), $slug: slug },
            }, ...roleStatements(account.id, roles),
            ...(approval ? [{ rql: 'INSERT INTO cms_registrations (user_id, verified, created_at) VALUES ($id, $verified, $now)', params: { $id: account.id, $verified: approval.verified ? 1 : 0, $now: now } }] : [])], WRITE);
        } catch (error) { throw memberError(error); }
        if (network) {
            // Without the network's record of the membership the member row is an orphan that
            // blocks the email: take it back out.
            try { await this.#accounts.join(account.id, this.#site); }
            catch (error) {
                await this.#db.write([
                    { rql: 'DELETE FROM cms_registrations WHERE user_id = $id', params: { $id: account.id } },
                    { rql: 'DELETE FROM cms_user_roles WHERE user_id = $id', params: { $id: account.id } },
                    { rql: 'DELETE FROM cms_users WHERE id = $id', params: { $id: account.id } },
                ], WRITE).catch(() => undefined);
                throw error;
            }
        }
        return (await this.get(account.id))!;
    }

    /** The meta to store: the field groups' check, or the input as given when users have no groups. */
    async #meta(meta: unknown, previous: { readonly [field: string]: unknown } | null, principal?: Principal): Promise<{ readonly [field: string]: unknown }> {
        if (this.#checkMeta) return this.#checkMeta(meta, previous, principal);
        if (meta === undefined) return previous ?? {};
        if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw new CmsError('CMS_VALIDATION', 'Meta must be an object of fields.', { fields: { meta: 'must be an object of fields.' } });
        return { ...previous, ...(meta as { [field: string]: unknown }) };
    }

    async get(id: string): Promise<CmsUser | null> {
        if (!ID.test(id)) return null;
        return (await this.getMany([id])).get(id) ?? null;
    }

    /** Users by ID, in reads that fit the result budget. Missing IDs are absent from the map. */
    async getMany(ids: readonly string[]): Promise<Map<string, CmsUser>> {
        const wanted = [...new Set(ids.filter(id => ID.test(id)))].slice(0, USERS_PER_READ);
        if (!wanted.length) return new Map();
        const list = inList('u', wanted);
        // Profiles hold their meta (bio, links): many users may come in smaller reads.
        const userRows = await readByIds(this.#db, wanted, slice => {
            const part = inList('u', slice);
            return { rql: `SELECT id, email, name, avatar, status, created_at, last_sign_in_at, meta, slug FROM cms_users WHERE id IN ${part.rql}`, params: part.params };
        });
        const result = await this.#db.read([
            // network_admin comes from the account alone (resolve): a site role row of that name, as a crafted import could add, grants nothing.
            { rql: `SELECT ur.user_id, r.id, r.name, r.permissions FROM cms_user_roles ur JOIN cms_roles r ON r.id = ur.role_id WHERE ur.user_id IN ${list.rql} AND r.id <> $networkAdmin ORDER BY r.id`, params: { ...list.params, $networkAdmin: NETWORK_ADMIN } },
            // On an added site, accounts in its own database are site accounts.
            ...(this.#siteAccounts ? [{ rql: `SELECT id FROM cms_accounts WHERE id IN ${list.rql}`, params: list.params }] : []),
        ]);
        const local = new Set((result.results[1]?.rows ?? []).map(row => row[0] as string));
        const roles = new Map<string, CmsUser['assignments'][number][]>();
        for (const [user, role, name, permissions] of result.results[0]!.rows) {
            const entry = roles.get(user as string) ?? [];
            entry.push(Object.freeze({ id: role as string, name: name as string, permissions: Object.freeze(JSON.parse(permissions as string) as string[]) }));
            roles.set(user as string, entry);
        }
        const users = new Map<string, CmsUser>();
        for (const row of userRows) {
            const assignments = roles.get(row[0] as string) ?? [];
            users.set(row[0] as string, Object.freeze({
                id: row[0] as string, email: row[1] as string, name: row[2] as string, avatar: row[3] as string | null,
                status: row[4] as CmsUser['status'], createdAt: Number(row[5] as bigint), lastSignInAt: row[6] === null ? null : Number(row[6] as bigint), meta: parseMeta(row[7]), slug: (row[8] as string | null) ?? null,
                roles: Object.freeze(assignments.map(role => role.id)), assignments: Object.freeze(assignments),
                permissions: Object.freeze([...new Set(assignments.flatMap(role => role.permissions))].sort()),
                account: local.has(row[0] as string) ? 'site' : 'network',
            }));
        }
        return users;
    }

    /** Users whose avatar is this media file or whose profile fields name it, newest first, 50 at most. */
    async usingFile(fileId: string): Promise<CmsUser[]> {
        if (!ID.test(fileId)) return [];
        const escaped = fileId.replace(/[\\%_]/g, character => `\\${character}`);
        const result = await this.#db.read([{
            rql: "SELECT id FROM cms_users WHERE avatar LIKE $avatar ESCAPE '\\' OR meta LIKE $meta ESCAPE '\\' ORDER BY created_at DESC LIMIT 50",
            params: { $avatar: `/media/${escaped}/%`, $meta: `%"${escaped}"%` },
        }]);
        const ids = result.results[0]!.rows.map(row => row[0] as string);
        const users = await this.getMany(ids);
        return ids.map(id => users.get(id)).filter((user): user is CmsUser => user !== undefined);
    }

    async findByEmail(email: string): Promise<CmsUser | null> {
        const result = await this.#db.read([{ rql: 'SELECT id FROM cms_users WHERE email = $email', params: { $email: normalizeEmail(email) } }]);
        const id = result.results[0]!.rows[0]?.[0] as string | undefined;
        return id ? this.get(id) : null;
    }

    /**
     * Every user, by ID, a page after the cursor of the one before: for work that goes through them
     * all. `next` is the last ID read (null once there are no more), so a page whose rows don't all
     * resolve to a user still moves on.
     */
    async after(after: string | null, limit = 100): Promise<{ users: CmsUser[]; next: string | null }> {
        const size = Math.min(Math.max(limit, 1), USERS_PER_READ);
        const result = await this.#db.read([{
            rql: `SELECT id FROM cms_users${after === null ? '' : ' WHERE id > $after'} ORDER BY id LIMIT $limit`,
            params: { ...(after === null ? {} : { $after: after }), $limit: size },
        }]);
        const ids = result.results[0]!.rows.map(row => row[0] as string);
        const users = await this.getMany(ids);
        return {
            users: ids.map(id => users.get(id)).filter((user): user is CmsUser => user !== undefined),
            next: ids.length === size ? ids[ids.length - 1]! : null,
        };
    }

    /** Newest first. `search` matches name or email; `role` limits to one role ID. */
    async list(options: { search?: string; role?: string; limit?: number; offset?: number } = {}): Promise<UserPage> {
        const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
        const offset = Math.min(Math.max(options.offset ?? 0, 0), 100_000);
        const conditions: string[] = [];
        const params: { [key: string]: Value } = {};
        if (options.search?.trim()) {
            conditions.push("(lower(name) LIKE $q ESCAPE '\\' OR email LIKE $q ESCAPE '\\')");
            params.$q = containsPattern(options.search.trim().slice(0, 100));
        }
        if (options.role) {
            conditions.push('id IN (SELECT user_id FROM cms_user_roles WHERE role_id = $role)');
            params.$role = options.role;
        }
        const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
        const result = await this.#db.read([
            { rql: `SELECT id FROM cms_users${where} ORDER BY created_at DESC, id DESC LIMIT $limit OFFSET $offset`, params: { ...params, $limit: limit, $offset: offset } },
            conditions.length ? { rql: `SELECT count(*) FROM cms_users${where}`, params } : { rql: 'SELECT count(*) FROM cms_users' },
        ]);
        const ids = result.results[0]!.rows.map(row => row[0] as string);
        const users = await this.getMany(ids);
        return { items: ids.map(id => users.get(id)).filter((user): user is CmsUser => user !== undefined), total: Number(result.results[1]!.rows[0]![0] as bigint) };
    }

    /**
     * Change the name, email or avatar (on the account first, then the copy here), the profile
     * meta or the author slug.
     */
    async update(id: string, patch: AccountProfile & { meta?: unknown; slug?: string }, options: { principal?: Principal } = {}): Promise<boolean> {
        const current = await this.get(id);
        if (!current) return false;
        const meta = patch.meta === undefined ? current.meta : await this.#meta(patch.meta, current.meta, options.principal);
        const profile = patch.name !== undefined || patch.email !== undefined || patch.avatar !== undefined
            ? await this.#store(current).update(id, { ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.email === undefined ? {} : { email: patch.email }), ...(patch.avatar === undefined ? {} : { avatar: patch.avatar }) })
            : current;
        if (!profile) return false;
        // A slug is chosen once, from the name, and kept: author URLs stay stable through renames. A given slug is checked and made unique.
        const slug = patch.slug !== undefined ? await this.#freeSlug(patch.slug, id) : current.slug ?? await this.#freeSlug(profile.name, id);
        try {
            const result = await this.#db.write([{ rql: 'UPDATE cms_users SET name = $name, email = $email, avatar = $avatar, meta = $meta, slug = $slug, updated_at = $now WHERE id = $id',
                params: { $name: profile.name, $email: profile.email, $avatar: profile.avatar, $meta: JSON.stringify(meta), $slug: slug, $now: this.#now(), $id: id } }], WRITE);
            return result.results[0]!.affected === 1n;
        } catch (error) { throw memberError(error); }
    }

    /**
     * Keep a value of the host's own in the user's meta, such as `_recent_blocks`, beside the
     * profile fields and without their checks; null removes it. False when there is no such user.
     */
    async setSystemMeta(id: string, key: string, value: unknown): Promise<boolean> {
        if (!SYSTEM_META.test(key)) throw new CmsError('CMS_VALIDATION', `${key} is not a system meta key.`);
        const current = await this.get(id);
        if (!current) return false;
        const meta: { [field: string]: unknown } = { ...current.meta, [key]: value };
        if (value === null || value === undefined) delete meta[key];
        const json = JSON.stringify(meta);
        if (json.length > 256 * 1024) throw new CmsError('CMS_LIMIT', 'The user\'s meta is too large.');
        const result = await this.#db.write([{ rql: 'UPDATE cms_users SET meta = $meta WHERE id = $id', params: { $meta: json, $id: id } }], WRITE);
        return result.results[0]!.affected === 1n;
    }

    /** The user with this author slug, or null. */
    async bySlug(slug: string): Promise<CmsUser | null> {
        if (!SLUG.test(slug)) return null;
        const result = await this.#db.read([{ rql: 'SELECT id FROM cms_users WHERE slug = $slug LIMIT 1', params: { $slug: slug } }]);
        const id = result.results[0]!.rows[0]?.[0] as string | undefined;
        return id ? this.get(id) : null;
    }

    /**
     * These users with slugs: users from before author pages get one from their name, written
     * once. For the site's pages, which link authors; dashboards read `slug` as is.
     */
    async withSlugs(users: ReadonlyMap<string, CmsUser>): Promise<Map<string, CmsUser>> {
        const result = new Map(users);
        for (const [id, user] of users) {
            if (user.slug) continue;
            const slug = await this.#freeSlug(user.name, id);
            await this.#db.write([{ rql: 'UPDATE cms_users SET slug = $slug WHERE id = $id AND slug IS NULL', params: { $slug: slug, $id: id } }], WRITE).catch(() => undefined);
            result.set(id, Object.freeze({ ...user, slug }));
        }
        return result;
    }

    /** Users who own entries, for author sitemaps and lists: those with a slug, oldest first. */
    async authors(options: { limit?: number; offset?: number } = {}): Promise<CmsUser[]> {
        const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
        const result = await this.#db.read([{ rql: 'SELECT id FROM cms_users WHERE slug IS NOT NULL AND status = $active ORDER BY created_at, id LIMIT $limit OFFSET $offset', params: { $active: 'active', $limit: limit, $offset: Math.max(options.offset ?? 0, 0) } }]);
        const ids = result.results[0]!.rows.map(row => row[0] as string);
        const users = await this.getMany(ids);
        return ids.map(id => users.get(id)).filter((user): user is CmsUser => user !== undefined);
    }

    /** A slug from the text, made unique among users other than `id` by a numeric suffix. */
    async #freeSlug(text: string, id: string): Promise<string> {
        const base = slugify(String(text ?? ''), 60) || 'author';
        const result = await this.#db.read([{ rql: "SELECT slug FROM cms_users WHERE id <> $id AND (slug = $slug OR slug LIKE $prefix ESCAPE '\\') LIMIT 1000", params: { $id: id, $slug: base, $prefix: `${base.replace(/[\\%_]/g, character => `\\${character}`)}-%` } }]);
        const taken = new Set(result.results[0]!.rows.map(row => row[0] as string));
        if (!taken.has(base)) return base;
        for (let n = 2; n < 10_000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
        return `${base}-${crypto.randomUUID().slice(0, 8)}`;
    }

    /**
     * Remove the member and their roles from this site. A network account stays; a site account
     * is deleted with what signs it in. Their records keep their owner ID.
     */
    async delete(id: string): Promise<boolean> {
        if (!ID.test(id)) return false;
        const user = await this.get(id);
        const params = { $id: id };
        const result = await this.#db.write([
            { rql: 'DELETE FROM cms_user_roles WHERE user_id = $id', params },
            { rql: 'DELETE FROM cms_users WHERE id = $id', params },
            { rql: 'DELETE FROM cms_registrations WHERE user_id = $id', params },
        ], WRITE);
        if (user?.account === 'site') await this.#siteAccounts!.delete(id);
        else await this.#accounts.leave(id, this.#site);
        return result.results[1]!.affected === 1n;
    }

    /** Whether a member waits for approval. */
    async awaitingApproval(id: string): Promise<boolean> {
        const result = await this.#db.read([{ rql: 'SELECT user_id FROM cms_registrations WHERE user_id = $id', params: { $id: id } }]);
        return result.results[0]!.rows.length > 0;
    }

    /** A held member opened their email link: they still wait for approval. */
    async confirmRegistration(id: string): Promise<boolean> {
        const result = await this.#db.write([{ rql: 'UPDATE cms_registrations SET verified = 1 WHERE user_id = $id', params: { $id: id } }], WRITE);
        return result.results[0]!.affected === 1n;
    }

    /** Members waiting for approval, oldest first, with whether their email is confirmed. */
    async registrations(options: { limit?: number } = {}): Promise<{ user: CmsUser; verified: boolean; createdAt: number }[]> {
        const result = await this.#db.read([{ rql: 'SELECT user_id, verified, created_at FROM cms_registrations ORDER BY created_at, user_id LIMIT $limit', params: { $limit: Math.min(Math.max(options.limit ?? 50, 1), 200) } }]);
        const rows = result.results[0]!.rows;
        const users = await Promise.all(rows.map(([id]) => this.get(String(id))));
        return rows.flatMap(([, verified, createdAt], index) => users[index] ? [{ user: users[index]!, verified: Number(verified as bigint) === 1, createdAt: Number(createdAt as bigint) }] : []);
    }

    /** How many members wait for approval. */
    async registrationCount(): Promise<number> {
        const result = await this.#db.read([{ rql: 'SELECT count(*) FROM cms_registrations' }]);
        return Number(result.results[0]!.rows[0]![0] as bigint);
    }

    /**
     * Approve a held member: their account is active, once their email is confirmed. False when
     * they were not waiting; `CMS_VALIDATION` while their email link was not opened yet.
     */
    async approve(id: string): Promise<boolean> {
        const result = await this.#db.read([{ rql: 'SELECT verified FROM cms_registrations WHERE user_id = $id', params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        if (!row) return false;
        if (Number(row[0] as bigint) !== 1) throw new CmsError('CMS_VALIDATION', 'This member has not confirmed their email address yet.');
        // Active first, then out of the queue: a failure between the two leaves the member
        // waiting, and approving again finishes it.
        if (!(await this.setStatus(id, 'active'))) return false;
        await this.#db.write([{ rql: 'DELETE FROM cms_registrations WHERE user_id = $id', params: { $id: id } }], WRITE);
        return true;
    }

    /**
     * Make a member's site account a network account, or a network account a site account of
     * this site, under the same ID: roles, profile and authorship stay. Only on an added site. A
     * network account must belong to this site alone and not run the network. The account's
     * sessions end, and its passkeys go with the host they were made on.
     */
    async convert(id: string, to: 'site' | 'network'): Promise<CmsUser> {
        if (!this.#siteAccounts) throw new CmsError('CMS_VALIDATION', 'Only added sites have site accounts.');
        const user = await this.get(id);
        if (!user) throw new CmsError('CMS_NOT_FOUND', 'There is no such member.');
        if (to === 'network') {
            if (user.account === 'site') {
                try { await this.#siteAccounts.moveTo(this.#accounts, id, { site: this.#site }); }
                catch (error) {
                    if (isCmsError(error, 'CMS_CONFLICT')) throw new CmsError('CMS_CONFLICT', 'A network account already has this email.', { fields: { email: 'is taken on the network.' } });
                    throw error;
                }
            }
        } else if (to === 'site') {
            // Also finishes a move that copied the account here but did not delete it on the network.
            const account = await this.#accounts.get(id);
            if (account) {
                if (account.networkRole) throw new CmsError('CMS_VALIDATION', 'Network admins keep network accounts.');
                if (((await this.#accounts.memberships([id])).get(id) ?? []).some(site => site !== this.#site)) {
                    throw new CmsError('CMS_VALIDATION', 'The account belongs to other sites too. Remove it from them first.');
                }
                await this.#accounts.moveTo(this.#siteAccounts, id);
            }
        } else throw new CmsError('CMS_VALIDATION', 'Choose a site or network account.');
        return (await this.get(id))!;
    }

    /** Replace a user's roles in one atomic batch. */
    async setRoles(id: string, roles: readonly string[]): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_user_roles WHERE user_id = $id', params: { $id: id } }, ...roleStatements(id, roles)], WRITE);
    }

    /** Allow or stop the account's sign-in, and copy the status here. */
    async setStatus(id: string, status: 'active' | 'disabled'): Promise<boolean> {
        const user = await this.get(id);
        if (!user || !(await this.#store(user).setStatus(id, status))) return false;
        const result = await this.#db.write([{ rql: 'UPDATE cms_users SET status = $status, updated_at = $now WHERE id = $id', params: { $status: status, $now: this.#now(), $id: id } }], WRITE);
        return result.results[0]!.affected === 1n;
    }

    /** Set the account's password. */
    async setPassword(id: string, password: string): Promise<boolean> {
        const user = await this.get(id);
        return user !== null && this.#store(user).setPassword(id, password);
    }

    /** The store of a member's account: this site's for a site account, the network's otherwise. */
    #store(user: CmsUser): CmsAccounts {
        return user.account === 'site' ? this.#siteAccounts! : this.#accounts;
    }

    async count(): Promise<number> {
        const result = await this.#db.read([{ rql: 'SELECT count(*) FROM cms_users' }]);
        return Number(result.results[0]!.rows[0]![0] as bigint);
    }

    /**
     * The member as the request user, or null unless their account is active. A network admin
     * also acts with `*` and holds the `network_admin` role. A child session passes the network
     * role it copied, so the account is not read: the network ends child sessions of an account
     * it suspends.
     */
    async resolve(id: string, session?: { networkRole: string | null }): Promise<CmsMember | null> {
        const [user, account] = await Promise.all([this.get(id), session ? null : (async () => await this.#siteAccounts?.get(id) ?? await this.#accounts.get(id))()]);
        if (!user || (!session && (!account || account.status !== 'active'))) return null;
        const admin = (session ? session.networkRole : account!.networkRole) === NETWORK_ADMIN;
        return Object.freeze({ ...user, principal: userPrincipal(user.id, admin ? [...user.roles, NETWORK_ADMIN] : user.roles, admin ? [...user.permissions, '*'] : user.permissions) });
    }

    /** The request principal for an active member, or null. */
    async principal(id: string): Promise<Principal | null> {
        return (await this.resolve(id))?.principal ?? null;
    }

    /** Create or replace a role by ID. */
    async defineRole(role: { id: string; name: string; permissions: readonly string[] }): Promise<CmsRole> {
        const permissions = checkRole(role);
        await this.#db.write([{
            rql: 'INSERT INTO cms_roles (id, name, permissions, created_at) VALUES ($id, $name, $permissions, $now) ON CONFLICT (id) DO UPDATE SET name = excluded.name, permissions = excluded.permissions',
            params: { $id: role.id, $name: role.name.trim(), $permissions: JSON.stringify(permissions), $now: this.#now() },
        }], WRITE);
        return (await this.role(role.id))!;
    }

    /**
     * A new role; its ID is derived from the name when omitted. With an `actor`, the role may
     * hold only permissions the actor holds, so a role manager cannot make a stronger role.
     */
    async createRole(role: { name: string; permissions: readonly string[]; id?: string }, options: { actor?: Principal } = {}): Promise<CmsRole> {
        const id = role.id ?? (slugify(role.name, 60) || crypto.randomUUID());
        const permissions = checkRole({ ...role, id });
        if (options.actor) checkGrant(options.actor, permissions);
        try {
            await this.#db.write([{ rql: 'INSERT INTO cms_roles (id, name, permissions, created_at) VALUES ($id, $name, $permissions, $now)',
                params: { $id: id, $name: role.name.trim(), $permissions: JSON.stringify(permissions), $now: this.#now() } }], WRITE);
        } catch (error) {
            if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE|PRIMARY|constraint/i.test(error.message)) throw new CmsError('CMS_CONFLICT', 'A role with this name already exists.', { fields: { name: 'is taken.' } });
            throw error;
        }
        return (await this.role(id))!;
    }

    /**
     * Change a role's name or permissions. The administrator role stays as it is. With an
     * `actor`, both the role as it is and as it becomes may hold only permissions the actor holds.
     */
    async updateRole(id: string, patch: { name?: string; permissions?: readonly string[] }, options: { actor?: Principal } = {}): Promise<boolean> {
        if (id === 'admin') throw new CmsError('CMS_FORBIDDEN', 'The administrator role cannot be changed.');
        const read = await this.#storedRole(id);
        if (!read) return false;
        const { role: current, stored } = read;
        const permissions = checkRole({ id, name: patch.name ?? current.name, permissions: patch.permissions ?? current.permissions });
        if (options.actor) {
            if (!holdsAll(options.actor, current.permissions)) throw new CmsError('CMS_FORBIDDEN', 'This role has permissions you do not have, so you cannot change it.');
            checkGrant(options.actor, permissions);
        }
        try {
            // Only over the permissions checked above: a role raised meanwhile is not overwritten.
            const result = await this.#db.write([{ rql: 'UPDATE cms_roles SET name = $name, permissions = $permissions WHERE id = $id AND permissions = $previous',
                params: { $id: id, $name: (patch.name ?? current.name).trim(), $permissions: JSON.stringify(permissions), $previous: stored } }], WRITE);
            if (result.results[0]!.affected === 1n) return true;
            if (await this.role(id)) throw new CmsError('CMS_CONFLICT', 'The role changed since it was read. Reload and try again.');
            return false;
        } catch (error) {
            if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE|constraint/i.test(error.message)) throw new CmsError('CMS_CONFLICT', 'A role with this name already exists.', { fields: { name: 'is taken.' } });
            throw error;
        }
    }

    /** Remove a role and its assignments. The administrator role stays, and an actor deletes only roles within their own permissions. */
    async deleteRole(id: string, options: { actor?: Principal } = {}): Promise<boolean> {
        if (id === 'admin') throw new CmsError('CMS_FORBIDDEN', 'The administrator role cannot be deleted.');
        let guard = '';
        let params: { [key: string]: Value } = { $id: id };
        if (options.actor) {
            const read = await this.#storedRole(id);
            if (!read) return false;
            if (!holdsAll(options.actor, read.role.permissions)) throw new CmsError('CMS_FORBIDDEN', 'This role has permissions you do not have, so you cannot delete it.');
            // Only the role as checked: one raised meanwhile stays.
            guard = ' AND EXISTS (SELECT 1 FROM cms_roles WHERE id = $id AND permissions = $previous)';
            params = { $id: id, $previous: read.stored };
        }
        const result = await this.#db.write([
            { rql: `DELETE FROM cms_user_roles WHERE role_id = $id${guard}`, params },
            { rql: `DELETE FROM cms_roles WHERE id = $id${guard ? ' AND permissions = $previous' : ''}`, params },
        ], WRITE);
        if (result.results[1]!.affected === 1n) return true;
        if (guard && await this.role(id)) throw new CmsError('CMS_CONFLICT', 'The role changed since it was read. Reload and try again.');
        return false;
    }

    /** The role and its permissions as stored, for a write guarded on them. */
    async #storedRole(id: string): Promise<{ role: CmsRole; stored: string } | null> {
        if (!ID.test(id)) return null;
        const result = await this.#db.read([{ rql: 'SELECT id, name, permissions, created_at FROM cms_roles WHERE id = $id', params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? { role: roleOf(row), stored: row[2] as string } : null;
    }

        async role(id: string): Promise<CmsRole | null> {
        if (!ID.test(id)) return null;
        const result = await this.#db.read([{ rql: 'SELECT id, name, permissions, created_at FROM cms_roles WHERE id = $id', params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? roleOf(row) : null;
    }

    /** Roles in creation order, each with its user count. */
    async roles(options: { search?: string; limit?: number; offset?: number } = {}): Promise<CmsRole[]> {
        const params: { [key: string]: Value } = { $limit: Math.min(Math.max(options.limit ?? 200, 1), 200), $offset: Math.max(options.offset ?? 0, 0) };
        let where = '';
        if (options.search?.trim()) { where = " WHERE lower(r.name) LIKE $q ESCAPE '\\'"; params.$q = containsPattern(options.search.trim().slice(0, 100)); }
        const result = await this.#db.read([{
            rql: `SELECT r.id, r.name, r.permissions, r.created_at, (SELECT count(*) FROM cms_user_roles ur WHERE ur.role_id = r.id) FROM cms_roles r${where} ORDER BY r.created_at, r.id LIMIT $limit OFFSET $offset`,
            params,
        }]);
        return result.results[0]!.rows.map(row => ({ ...roleOf(row), userCount: Number(row[4] as bigint) }));
    }

    async countRoles(options: { search?: string } = {}): Promise<number> {
        const result = await this.#db.read([options.search?.trim()
            ? { rql: "SELECT count(*) FROM cms_roles WHERE lower(name) LIKE $q ESCAPE '\\'", params: { $q: containsPattern(options.search.trim().slice(0, 100)) } }
            : { rql: 'SELECT count(*) FROM cms_roles' }]);
        return Number(result.results[0]!.rows[0]![0] as bigint);
    }
}

function roleOf(row: readonly Value[]): CmsRole {
    return { id: row[0] as string, name: row[1] as string, permissions: JSON.parse(row[2] as string) as string[], createdAt: Number(row[3] as bigint) };
}

function roleStatements(userId: string, roles: readonly string[]): Statement[] {
    return [...new Set(roles)].map(role => {
        if (!ID.test(role)) throw new CmsError('CMS_VALIDATION', `Invalid role ${role}.`);
        // Insert only roles that exist; the caller checks the outcome through get().
        return { rql: 'INSERT INTO cms_user_roles (user_id, role_id) SELECT $user, id FROM cms_roles WHERE id = $role', params: { $user: userId, $role: role } as { [key: string]: Value } };
    });
}

/** A role manager gives only permissions they hold. */
function checkGrant(actor: Principal, permissions: readonly string[]): void {
    const missing = permissions.filter(permission => !holdsAll(actor, [permission]));
    if (missing.length) throw new CmsError('CMS_FORBIDDEN', `You cannot give a role permissions you do not have: ${missing.join(', ')}.`, { fields: { permissions: 'include permissions you do not have.' } });
}

function checkRole(role: { id: string; name: string; permissions: readonly string[] }): string[] {
    if (!ID.test(role.id) || typeof role.name !== 'string' || !role.name.trim() || role.name.length > 80) throw new CmsError('CMS_VALIDATION', 'Enter a role name of at most 80 characters.', { fields: { name: 'is required.' } });
    if (role.id === NETWORK_ADMIN) throw new CmsError('CMS_VALIDATION', 'network_admin is the network\'s role; choose another name.', { fields: { name: 'is reserved.' } });
    const invalid = role.permissions.filter(permission => !PERMISSION.test(permission));
    if (invalid.length) throw new CmsError('CMS_VALIDATION', `Unknown permission ${invalid.join(', ')}.`, { fields: { permissions: 'are invalid.' } });
    return [...new Set(role.permissions)].sort();
}

function memberError(error: unknown): unknown {
    if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE/i.test(error.message)) return new CmsError('CMS_CONFLICT', 'A user with this email already exists.', { fields: { email: 'is taken.' } });
    if (error instanceof ClientError && error.outcome === 'rolled-back' && /FOREIGN|role/i.test(error.message)) return new CmsError('CMS_VALIDATION', 'Unknown role.');
    return error;
}

export { normalizeEmail };
