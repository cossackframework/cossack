/** Users, roles and password-reset tokens on relational host tables. Emails are normalized to lowercase. */
import { createCredentialVerifier, createPasswordHasher, type CredentialVerifier, type PasswordHasher } from '@cossackframework/auth';
import { ClientError, type RomeDB, type Statement, type Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { slugify } from '../fields';
import { userPrincipal, type Principal } from '../permissions';
import { parseMeta, type MetaCheck } from './taxonomies';

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
    /** When the user last started a session, or null when never. */
    readonly lastSignInAt: number | null;
    /** Values of the field groups attached to users, and the author profile (`AUTHOR_FIELDS`). */
    readonly meta: { readonly [field: string]: unknown };
    /** The author page's slug, such as `ada-lovelace`; null until the user is saved or `withSlugs` runs. */
    readonly slug: string | null;
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

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const PERMISSION = /^(?:\*|[a-z][a-z0-9:/._*-]{0,127})$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WRITE = { kind: 'cms.users', retryConflicts: 5 } as const;

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');

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

export class CmsUsers {
    readonly #db: RomeDB;
    readonly #hasher: PasswordHasher;
    readonly #now: () => number;
    readonly #checkMeta: MetaCheck | undefined;
    readonly verifier: CredentialVerifier<CmsUser>;

    constructor(db: RomeDB, options: { hasher?: PasswordHasher; now?: () => number; checkMeta?: MetaCheck } = {}) {
        this.#db = db;
        this.#hasher = options.hasher ?? createPasswordHasher();
        this.#now = options.now ?? Date.now;
        this.#checkMeta = options.checkMeta;
        type Row = { id: string; hash: string | null; status: string };
        this.verifier = createCredentialVerifier<Row, CmsUser>({
            find: async email => {
                const result = await this.#db.read([{ rql: 'SELECT id, password_hash, status FROM cms_users WHERE email = $email', params: { $email: normalizeEmail(email) } }]);
                const row = result.results[0]!.rows[0];
                return row ? { id: row[0] as string, hash: row[1] as string | null, status: row[2] as string } : null;
            },
            passwordHash: row => row.status === 'active' ? row.hash : null,
            user: async row => (await this.get(row.id))!,
            hasher: this.#hasher,
            replacePasswordHash: async (row, expected, replacement) => {
                const result = await this.#db.write([{ rql: 'UPDATE cms_users SET password_hash = $next, updated_at = $now WHERE id = $id AND password_hash = $expected',
                    params: { $next: replacement, $now: this.#now(), $id: row.id, $expected: expected } }], WRITE);
                return result.results[0]!.affected === 1n;
            },
        });
    }

    async create(input: { email: string; name: string; password?: string; roles?: readonly string[]; id?: string; avatar?: string | null; meta?: unknown }): Promise<CmsUser> {
        const email = normalizeEmail(input.email);
        checkProfile({ email, name: input.name, avatar: input.avatar ?? null });
        const meta = await this.#meta(input.meta, null);
        if (input.password !== undefined) checkPassword(input.password);
        const id = input.id ?? crypto.randomUUID();
        if (!ID.test(id)) throw new CmsError('CMS_VALIDATION', 'Invalid user ID.');
        const hash = input.password === undefined ? null : await this.#hasher.hash(input.password);
        const now = this.#now();
        const slug = await this.#freeSlug(input.name, id);
        const statements: Statement[] = [{
            rql: "INSERT INTO cms_users (id, email, name, password_hash, avatar, status, created_at, updated_at, meta, slug) VALUES ($id, $email, $name, $hash, $avatar, 'active', $now, $now, $meta, $slug)",
            params: { $id: id, $email: email, $name: input.name.trim(), $hash: hash, $avatar: input.avatar ?? null, $now: now, $meta: JSON.stringify(meta), $slug: slug },
        }, ...roleStatements(id, input.roles ?? [])];
        try { await this.#db.write(statements, WRITE); }
        catch (error) { throw uniqueEmail(error); }
        return (await this.get(id))!;
    }

    /** The meta to store: the field groups' check, or the input as given when users have no groups. */
    async #meta(meta: unknown, previous: { readonly [field: string]: unknown } | null): Promise<{ readonly [field: string]: unknown }> {
        if (this.#checkMeta) return this.#checkMeta(meta, previous);
        if (meta === undefined) return previous ?? {};
        if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw new CmsError('CMS_VALIDATION', 'Meta must be an object of fields.', { fields: { meta: 'must be an object of fields.' } });
        return { ...previous, ...(meta as { [field: string]: unknown }) };
    }

    async get(id: string): Promise<CmsUser | null> {
        if (!ID.test(id)) return null;
        return (await this.getMany([id])).get(id) ?? null;
    }

    /** Users by ID in one read. Missing IDs are absent from the map. */
    async getMany(ids: readonly string[]): Promise<Map<string, CmsUser>> {
        const wanted = [...new Set(ids.filter(id => ID.test(id)))].slice(0, 200);
        if (!wanted.length) return new Map();
        const list = inList('u', wanted);
        const result = await this.#db.read([
            { rql: `SELECT id, email, name, avatar, status, created_at, last_sign_in_at, meta, slug FROM cms_users WHERE id IN ${list.rql}`, params: list.params },
            { rql: `SELECT ur.user_id, r.id, r.name, r.permissions FROM cms_user_roles ur JOIN cms_roles r ON r.id = ur.role_id WHERE ur.user_id IN ${list.rql} ORDER BY r.id`, params: list.params },
        ]);
        const roles = new Map<string, CmsUser['assignments'][number][]>();
        for (const [user, role, name, permissions] of result.results[1]!.rows) {
            const entry = roles.get(user as string) ?? [];
            entry.push(Object.freeze({ id: role as string, name: name as string, permissions: Object.freeze(JSON.parse(permissions as string) as string[]) }));
            roles.set(user as string, entry);
        }
        const users = new Map<string, CmsUser>();
        for (const row of result.results[0]!.rows) {
            const assignments = roles.get(row[0] as string) ?? [];
            users.set(row[0] as string, Object.freeze({
                id: row[0] as string, email: row[1] as string, name: row[2] as string, avatar: row[3] as string | null,
                status: row[4] as CmsUser['status'], createdAt: Number(row[5] as bigint), lastSignInAt: row[6] === null ? null : Number(row[6] as bigint), meta: parseMeta(row[7]), slug: (row[8] as string | null) ?? null,
                roles: Object.freeze(assignments.map(role => role.id)), assignments: Object.freeze(assignments),
                permissions: Object.freeze([...new Set(assignments.flatMap(role => role.permissions))].sort()),
            }));
        }
        return users;
    }

    async findByEmail(email: string): Promise<CmsUser | null> {
        const result = await this.#db.read([{ rql: 'SELECT id FROM cms_users WHERE email = $email', params: { $email: normalizeEmail(email) } }]);
        const id = result.results[0]!.rows[0]?.[0] as string | undefined;
        return id ? this.get(id) : null;
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

    /** Change name, email, avatar, profile meta or the author slug. */
    async update(id: string, patch: { name?: string; email?: string; avatar?: string | null; meta?: unknown; slug?: string }): Promise<boolean> {
        const current = await this.get(id);
        if (!current) return false;
        const next = { name: patch.name ?? current.name, email: patch.email === undefined ? current.email : normalizeEmail(patch.email), avatar: patch.avatar === undefined ? current.avatar : patch.avatar || null };
        checkProfile(next);
        const meta = patch.meta === undefined ? current.meta : await this.#meta(patch.meta, current.meta);
        // A slug is chosen once, from the name, and kept: author URLs stay stable through renames. A given slug is checked and made unique.
        const slug = patch.slug !== undefined ? await this.#freeSlug(patch.slug, id) : current.slug ?? await this.#freeSlug(next.name, id);
        try {
            const result = await this.#db.write([{ rql: 'UPDATE cms_users SET name = $name, email = $email, avatar = $avatar, meta = $meta, slug = $slug, updated_at = $now WHERE id = $id',
                params: { $name: next.name.trim(), $email: next.email, $avatar: next.avatar, $meta: JSON.stringify(meta), $slug: slug, $now: this.#now(), $id: id } }], WRITE);
            return result.results[0]!.affected === 1n;
        } catch (error) { throw uniqueEmail(error); }
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

    /** Remove a user with their roles, sessions and reset tokens in one batch. Their records keep their owner ID. */
    async delete(id: string): Promise<boolean> {
        if (!ID.test(id)) return false;
        const params = { $id: id };
        const result = await this.#db.write([
            { rql: 'DELETE FROM cms_user_roles WHERE user_id = $id', params },
            { rql: 'DELETE FROM cms_auth_sessions WHERE user_id = $id', params },
            { rql: 'DELETE FROM cms_password_resets WHERE user_id = $id', params },
            { rql: 'DELETE FROM cms_users WHERE id = $id', params },
        ], WRITE);
        return result.results[3]!.affected === 1n;
    }

    /** Replace a user's roles in one atomic batch. */
    async setRoles(id: string, roles: readonly string[]): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_user_roles WHERE user_id = $id', params: { $id: id } }, ...roleStatements(id, roles)], WRITE);
    }

    async setStatus(id: string, status: 'active' | 'disabled'): Promise<boolean> {
        const result = await this.#db.write([{ rql: 'UPDATE cms_users SET status = $status, updated_at = $now WHERE id = $id', params: { $status: status, $now: this.#now(), $id: id } }], WRITE);
        return result.results[0]!.affected === 1n;
    }

    async setPassword(id: string, password: string): Promise<boolean> {
        checkPassword(password);
        const result = await this.#db.write([{ rql: 'UPDATE cms_users SET password_hash = $hash, updated_at = $now WHERE id = $id', params: { $hash: await this.#hasher.hash(password), $now: this.#now(), $id: id } }], WRITE);
        return result.results[0]!.affected === 1n;
    }

    async count(): Promise<number> {
        const result = await this.#db.read([{ rql: 'SELECT count(*) FROM cms_users' }]);
        return Number(result.results[0]!.rows[0]![0] as bigint);
    }

    /** The request principal for an active user, or null. */
    async principal(id: string): Promise<Principal | null> {
        const user = await this.get(id);
        return user && user.status === 'active' ? userPrincipal(user.id, user.roles, user.permissions) : null;
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

    /** A new role; its ID is derived from the name when omitted. */
    async createRole(role: { name: string; permissions: readonly string[]; id?: string }): Promise<CmsRole> {
        const id = role.id ?? (slugify(role.name, 60) || crypto.randomUUID());
        const permissions = checkRole({ ...role, id });
        try {
            await this.#db.write([{ rql: 'INSERT INTO cms_roles (id, name, permissions, created_at) VALUES ($id, $name, $permissions, $now)',
                params: { $id: id, $name: role.name.trim(), $permissions: JSON.stringify(permissions), $now: this.#now() } }], WRITE);
        } catch (error) {
            if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE|PRIMARY|constraint/i.test(error.message)) throw new CmsError('CMS_CONFLICT', 'A role with this name already exists.', { fields: { name: 'is taken.' } });
            throw error;
        }
        return (await this.role(id))!;
    }

    async updateRole(id: string, patch: { name?: string; permissions?: readonly string[] }): Promise<boolean> {
        const current = await this.role(id);
        if (!current) return false;
        const permissions = checkRole({ id, name: patch.name ?? current.name, permissions: patch.permissions ?? current.permissions });
        try {
            const result = await this.#db.write([{ rql: 'UPDATE cms_roles SET name = $name, permissions = $permissions WHERE id = $id',
                params: { $id: id, $name: (patch.name ?? current.name).trim(), $permissions: JSON.stringify(permissions) } }], WRITE);
            return result.results[0]!.affected === 1n;
        } catch (error) {
            if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE|constraint/i.test(error.message)) throw new CmsError('CMS_CONFLICT', 'A role with this name already exists.', { fields: { name: 'is taken.' } });
            throw error;
        }
    }

    /** Remove a role and its assignments. The administrator role stays. */
    async deleteRole(id: string): Promise<boolean> {
        if (id === 'admin') throw new CmsError('CMS_FORBIDDEN', 'The administrator role cannot be deleted.');
        const result = await this.#db.write([
            { rql: 'DELETE FROM cms_user_roles WHERE role_id = $id', params: { $id: id } },
            { rql: 'DELETE FROM cms_roles WHERE id = $id', params: { $id: id } },
        ], WRITE);
        return result.results[1]!.affected === 1n;
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

    /**
     * A one-time reset token for an active account, or null for an unknown email. The token is
     * returned once; the table keeps only its SHA-256, and earlier tokens for the user end.
     */
    async createPasswordReset(email: string, options: { ttlMs?: number } = {}): Promise<{ token: string; user: CmsUser } | null> {
        const user = await this.findByEmail(email);
        if (!user || user.status !== 'active') return null;
        const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const now = this.#now();
        await this.#db.write([
            { rql: 'DELETE FROM cms_password_resets WHERE user_id = $user', params: { $user: user.id } },
            { rql: 'INSERT INTO cms_password_resets (id, user_id, created_at, expires_at) VALUES ($id, $user, $now, $expires)',
                params: { $id: await sha256(token), $user: user.id, $now: now, $expires: now + (options.ttlMs ?? 60 * 60_000) } },
        ], WRITE);
        return { token, user };
    }

    /**
     * Set a new password with a reset token. One conditional delete consumes the token, so
     * only one request can use it; the user's sessions end with the change.
     */
    async resetPassword(token: string, password: string): Promise<boolean> {
        if (typeof token !== 'string' || !TOKEN.test(token)) return false;
        checkPassword(password);
        const id = await sha256(token);
        const found = await this.#db.read([{ rql: 'SELECT user_id FROM cms_password_resets WHERE id = $id AND expires_at > $now', params: { $id: id, $now: this.#now() } }]);
        const user = found.results[0]!.rows[0]?.[0] as string | undefined;
        if (!user) return false;
        const hash = await this.#hasher.hash(password);
        const guard = 'EXISTS (SELECT 1 FROM cms_password_resets WHERE id = $id AND user_id = $user AND expires_at > $now)';
        const params = { $id: id, $user: user, $now: this.#now() };
        // The password and sessions change only if this request still holds the token.
        const result = await this.#db.write([
            { rql: `UPDATE cms_users SET password_hash = $hash, updated_at = $now WHERE id = $user AND ${guard}`, params: { ...params, $hash: hash } },
            { rql: `DELETE FROM cms_auth_sessions WHERE user_id = $user AND ${guard}`, params },
            { rql: 'DELETE FROM cms_password_resets WHERE id = $id AND user_id = $user AND expires_at > $now', params },
        ], WRITE);
        return result.results[2]!.affected === 1n && result.results[0]!.affected === 1n;
    }

    async purgeExpiredResets(): Promise<number> {
        const expired = await this.#db.read([{ rql: 'SELECT 1 FROM cms_password_resets WHERE expires_at <= $now LIMIT 1', params: { $now: this.#now() } }]);
        if (!expired.results[0]!.rows.length) return 0;
        const result = await this.#db.write([{ rql: 'DELETE FROM cms_password_resets WHERE id IN (SELECT id FROM cms_password_resets WHERE expires_at <= $now LIMIT 500)', params: { $now: this.#now() } }], WRITE);
        return Number(result.results[0]!.affected);
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

function checkProfile(profile: { email: string; name: string; avatar: string | null }): void {
    if (!EMAIL.test(profile.email)) throw new CmsError('CMS_VALIDATION', 'Enter a valid email address.', { fields: { email: 'is invalid.' } });
    if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 120) throw new CmsError('CMS_VALIDATION', 'Enter a name of at most 120 characters.', { fields: { name: 'is required.' } });
    if (profile.avatar !== null && (typeof profile.avatar !== 'string' || profile.avatar.length > 2048 || !/^(?:https:\/\/|\/)[^\s]*$/.test(profile.avatar))) {
        throw new CmsError('CMS_VALIDATION', 'The avatar must be an https URL or a site path.', { fields: { avatar: 'is invalid.' } });
    }
}

function checkPassword(password: string): void {
    if (typeof password !== 'string' || password.length < 8) throw new CmsError('CMS_VALIDATION', 'Passwords need at least 8 characters.', { fields: { password: 'is too short.' } });
    if (new TextEncoder().encode(password).length > 1024) throw new CmsError('CMS_VALIDATION', 'Passwords can be at most 1024 bytes.', { fields: { password: 'is too long.' } });
}

function checkRole(role: { id: string; name: string; permissions: readonly string[] }): string[] {
    if (!ID.test(role.id) || typeof role.name !== 'string' || !role.name.trim() || role.name.length > 80) throw new CmsError('CMS_VALIDATION', 'Enter a role name of at most 80 characters.', { fields: { name: 'is required.' } });
    const invalid = role.permissions.filter(permission => !PERMISSION.test(permission));
    if (invalid.length) throw new CmsError('CMS_VALIDATION', `Unknown permission ${invalid.join(', ')}.`, { fields: { permissions: 'are invalid.' } });
    return [...new Set(role.permissions)].sort();
}

function uniqueEmail(error: unknown): unknown {
    if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE/i.test(error.message)) return new CmsError('CMS_CONFLICT', 'A user with this email already exists.', { fields: { email: 'is taken.' } });
    if (error instanceof ClientError && error.outcome === 'rolled-back' && /FOREIGN|role/i.test(error.message)) return new CmsError('CMS_VALIDATION', 'Unknown role.');
    return error;
}

export function normalizeEmail(email: string): string {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}
