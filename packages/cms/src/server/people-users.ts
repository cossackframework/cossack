/**
 * A site's users over the people port (`people.ts`): who they are and which roles they hold
 * come from the port; the author slug (`cms_authors`) and the values of the field groups
 * attached to users (`cms/user_fields`) are the CMS's own, under the user's ID.
 *
 * It answers as `CmsUsers` does for everything the CMS itself needs. What is about accounts
 * and sign-in (passwords, statuses, registrations, the two kinds of account, role screens) is
 * the application's, on the dashboard package, and is refused here.
 */
import { ClientError, type RomeDB, type Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { SYSTEM_META } from '../field-groups';
import { slugify } from '../fields';
import { NETWORK_ADMIN, userPrincipal, type Principal } from '../permissions';
import type { MetaCheck } from './taxonomies';
import { uniqueFieldOf, type FieldValues } from './field-values';
import { personPermissions, type PeoplePort, type Person, type PersonRole } from './people';
import { CmsUsers, type CmsMember, type CmsRole, type CmsUser, type UserPage } from './users';

const NO_VALUES: { readonly [field: string]: unknown } = Object.freeze({});
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WRITE = { kind: 'cms.users', retryConflicts: 5 } as const;
const PER_READ = 200;

const elsewhere = (what: string): never => {
    throw new CmsError('CMS_UNAVAILABLE', `${what} is the application's, not the CMS's: use the dashboard package's services.`, { lasting: true });
};

export class PeopleUsers extends CmsUsers {
    readonly #db: RomeDB;
    readonly #people: PeoplePort;
    readonly #fields: FieldValues;
    readonly #checkMeta: MetaCheck | undefined;

    constructor(db: RomeDB, options: ConstructorParameters<typeof CmsUsers>[1] & { people: PeoplePort }) {
        super(db, options);
        this.#db = db;
        this.#people = options.people;
        this.#fields = options.fields;
        this.#checkMeta = options.checkMeta;
    }

    async #meta(meta: unknown, previous: { readonly [field: string]: unknown } | null, principal?: Principal): Promise<{ readonly [field: string]: unknown }> {
        if (this.#checkMeta) return this.#checkMeta(meta, previous, principal);
        if (meta === undefined) return previous ?? {};
        if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw new CmsError('CMS_VALIDATION', 'Meta must be an object of fields.', { fields: { meta: 'must be an object of fields.' } });
        return { ...previous, ...(meta as { [field: string]: unknown }) };
    }

    async #slugs(ids: readonly string[]): Promise<Map<string, string>> {
        if (!ids.length) return new Map();
        const params = Object.fromEntries(ids.map((id, index) => [`$u${index}`, id])) as { [key: string]: Value };
        const result = await this.#db.read([{ rql: `SELECT user_id, slug FROM cms_authors WHERE user_id IN (${ids.map((_, index) => `$u${index}`).join(', ')})`, params }]);
        return new Map(result.results[0]!.rows.map(row => [row[0] as string, row[1] as string]));
    }

    /** A slug from the text, made unique among authors other than `id` by a numeric suffix. */
    async #freeSlug(text: string, id: string): Promise<string> {
        const base = slugify(String(text ?? ''), 60) || 'author';
        const result = await this.#db.read([{ rql: "SELECT slug FROM cms_authors WHERE user_id <> $id AND (slug = $slug OR slug LIKE $prefix ESCAPE '\\') LIMIT 1000",
            params: { $id: id, $slug: base, $prefix: `${base.replace(/[\\%_]/g, character => `\\${character}`)}-%` } }]);
        const taken = new Set(result.results[0]!.rows.map(row => row[0] as string));
        if (!taken.has(base)) return base;
        for (let n = 2; n < 10_000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
        return `${base}-${crypto.randomUUID().slice(0, 8)}`;
    }

    #user(person: Person, meta: { readonly [field: string]: unknown }, slug: string | null): CmsUser {
        const assignments = [...person.roles].sort((a, b) => a.id < b.id ? -1 : 1);
        return Object.freeze({
            id: person.id, email: person.email, name: person.name, avatar: person.avatar, status: person.status,
            createdAt: person.createdAt, lastSignInAt: person.lastSignInAt, meta, slug,
            roles: Object.freeze(assignments.map(role => role.id)), assignments: Object.freeze(assignments),
            permissions: Object.freeze([...new Set(assignments.flatMap(role => role.permissions))].sort()),
            account: person.account,
        });
    }

    async #users(people: ReadonlyMap<string, Person>): Promise<Map<string, CmsUser>> {
        const ids = [...people.keys()];
        const [values, slugs] = await Promise.all([ids.length ? this.#fields.read(ids) : new Map<string, { readonly [field: string]: unknown }>(), this.#slugs(ids)]);
        return new Map(ids.map(id => [id, this.#user(people.get(id)!, values.get(id) ?? NO_VALUES, slugs.get(id) ?? null)]));
    }

    override async get(id: string): Promise<CmsUser | null> {
        return (await this.getMany([id])).get(id) ?? null;
    }

    override async getMany(ids: readonly string[]): Promise<Map<string, CmsUser>> {
        const wanted = [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0))].slice(0, PER_READ);
        if (!wanted.length) return new Map();
        return this.#users(await this.#people.getMany(wanted));
    }

    override async findByEmail(email: string): Promise<CmsUser | null> {
        const person = await this.#people.findByEmail(email);
        return person ? (await this.#users(new Map([[person.id, person]]))).get(person.id)! : null;
    }

    override async list(options: { search?: string; role?: string; limit?: number; offset?: number } = {}): Promise<UserPage> {
        const page = await this.#people.list({ ...options, limit: Math.min(Math.max(options.limit ?? 20, 1), 100) });
        const users = await this.#users(new Map(page.users.map(person => [person.id, person])));
        return { items: page.users.map(person => users.get(person.id)!), total: page.total };
    }

    override async count(): Promise<number> { return this.#people.count(); }

    /** The file IDs users' profile fields name. A picture a user uploaded as an avatar is the application's to find. */
    override async usingFile(fileId: string): Promise<CmsUser[]> {
        const ids = (await this.#fields.usingFile(fileId)).slice(0, 50);
        const users = await this.getMany(ids);
        return ids.map(id => users.get(id)).filter((user): user is CmsUser => user !== undefined);
    }

    override async create(input: { email: string; name: string; password?: string; roles?: readonly string[]; id?: string; meta?: unknown }): Promise<CmsUser> {
        const meta = await this.#meta(input.meta, null);
        const person = await this.#people.create({ email: input.email, name: input.name, ...(input.password === undefined ? {} : { password: input.password }), ...(input.roles ? { roles: input.roles } : {}), ...(input.id ? { id: input.id } : {}) });
        try {
            await this.#db.write([
                { rql: 'INSERT INTO cms_authors (user_id, slug) VALUES ($id, $slug)', params: { $id: person.id, $slug: await this.#freeSlug(person.name, person.id) } },
                ...this.#fields.save(person.id, meta, null, crypto.randomUUID()),
            ], WRITE);
        } catch (error) {
            // Without their document the user would be half made: take the account back out.
            await this.#people.delete(person.id).catch(() => undefined);
            throw fieldError(error);
        }
        return (await this.get(person.id))!;
    }

    override async update(id: string, patch: { name?: string; email?: string; avatar?: string | null; meta?: unknown; slug?: string }, options: { principal?: Principal } = {}): Promise<boolean> {
        const current = await this.get(id);
        if (!current) return false;
        const meta = patch.meta === undefined ? current.meta : await this.#meta(patch.meta, current.meta, options.principal);
        if (patch.name !== undefined || patch.email !== undefined || patch.avatar !== undefined) {
            const { meta: _meta, slug: _slug, ...profile } = patch;
            if (!await this.#people.update(id, profile)) return false;
        }
        // A slug is chosen once, from the name, and kept: author URLs stay stable through renames.
        const slug = patch.slug !== undefined ? await this.#freeSlug(patch.slug, id) : current.slug ?? await this.#freeSlug(patch.name ?? current.name, id);
        try {
            await this.#db.write([
                { rql: 'INSERT INTO cms_authors (user_id, slug) VALUES ($id, $slug) ON CONFLICT (user_id) DO UPDATE SET slug = excluded.slug', params: { $id: id, $slug: slug } },
                ...(patch.meta === undefined ? [] : this.#fields.save(id, meta, current.meta, crypto.randomUUID())),
            ], WRITE);
        } catch (error) { throw fieldError(error); }
        return true;
    }

    override async setSystemMeta(id: string, key: string, value: unknown): Promise<boolean> {
        if (!SYSTEM_META.test(key)) throw new CmsError('CMS_VALIDATION', `${key} is not a system meta key.`);
        if (value !== null && value !== undefined && JSON.stringify(value).length > 256 * 1024) throw new CmsError('CMS_LIMIT', 'The value is too large.');
        if (!(await this.#people.getMany([id])).has(id)) return false;
        await this.#db.write(this.#fields.setOne(id, key, value, crypto.randomUUID()), WRITE);
        return true;
    }

    override async bySlug(slug: string): Promise<CmsUser | null> {
        if (!SLUG.test(slug)) return null;
        const result = await this.#db.read([{ rql: 'SELECT user_id FROM cms_authors WHERE slug = $slug LIMIT 1', params: { $slug: slug } }]);
        const id = result.results[0]!.rows[0]?.[0] as string | undefined;
        return id ? this.get(id) : null;
    }

    override async withSlugs(users: ReadonlyMap<string, CmsUser>): Promise<Map<string, CmsUser>> {
        const result = new Map(users);
        for (const [id, user] of users) {
            if (user.slug) continue;
            const slug = await this.#freeSlug(user.name, id);
            await this.#db.write([{ rql: 'INSERT INTO cms_authors (user_id, slug) VALUES ($id, $slug) ON CONFLICT (user_id) DO NOTHING', params: { $id: id, $slug: slug } }], WRITE).catch(() => undefined);
            result.set(id, Object.freeze({ ...user, slug }));
        }
        return result;
    }

    /** Users who have an author page, oldest slug first; only the active ones. */
    override async authors(options: { limit?: number; offset?: number } = {}): Promise<CmsUser[]> {
        const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
        const result = await this.#db.read([{ rql: 'SELECT user_id FROM cms_authors ORDER BY rowid LIMIT $limit OFFSET $offset', params: { $limit: limit, $offset: Math.max(options.offset ?? 0, 0) } }]);
        const ids = result.results[0]!.rows.map(row => row[0] as string);
        const found = new Map<string, CmsUser>();
        for (let at = 0; at < ids.length; at += PER_READ) for (const [id, user] of await this.getMany(ids.slice(at, at + PER_READ))) found.set(id, user);
        return ids.map(id => found.get(id)).filter((user): user is CmsUser => user !== undefined && user.status === 'active');
    }

    override async delete(id: string): Promise<boolean> {
        if (!await this.#people.delete(id)) return false;
        await this.#db.write([{ rql: 'DELETE FROM cms_authors WHERE user_id = $id', params: { $id: id } }, this.#fields.remove(id)], WRITE);
        return true;
    }

    override async setRoles(id: string, roles: readonly string[]): Promise<void> {
        await this.#people.setRoles(id, roles);
    }

    /** The member as the request user, or null unless active. A network administrator also acts with `*` and holds `network_admin`. */
    override async resolve(id: string): Promise<CmsMember | null> {
        const person = (await this.#people.getMany([id])).get(id);
        if (!person || person.status !== 'active') return null;
        const user = (await this.#users(new Map([[id, person]]))).get(id)!;
        return Object.freeze({ ...user, principal: userPrincipal(user.id, person.networkAdmin ? [...user.roles, NETWORK_ADMIN] : user.roles, personPermissions(person).includes('*') ? [...user.permissions, '*'] : user.permissions) });
    }

    override async principal(id: string): Promise<Principal | null> {
        return (await this.resolve(id))?.principal ?? null;
    }

    override async defineRole(role: { id: string; name: string; permissions: readonly string[] }): Promise<CmsRole> {
        return cmsRole(await this.#people.defineRole(role));
    }

    override async role(id: string): Promise<CmsRole | null> {
        const role = await this.#people.role(id);
        return role ? cmsRole(role) : null;
    }

    override async roles(options: { search?: string; limit?: number; offset?: number } = {}): Promise<CmsRole[]> {
        const search = options.search?.trim().toLowerCase();
        const all = (await this.#people.roles()).filter(role => !search || role.name.toLowerCase().includes(search));
        const offset = Math.max(options.offset ?? 0, 0);
        return all.slice(offset, offset + Math.min(Math.max(options.limit ?? 200, 1), 200)).map(cmsRole);
    }

    override async countRoles(options: { search?: string } = {}): Promise<number> {
        return (await this.roles({ ...options, limit: 200 })).length;
    }

    // --- The application's, on the dashboard package ---
    /** Make a network account a member of this site. The roles it gets are the ones named. */
    override async addMember(accountId: string, options: { roles?: readonly string[]; meta?: unknown } = {}): Promise<CmsUser | null> {
        if (!this.#people.join) return elsewhere('Adding a member');
        const person = await this.#people.join(accountId, options.roles ?? []);
        return person ? this.get(person.id) : null;
    }
    /** Every user, a page at a time. The cursor is the place in the port's list. */
    override async after(after: string | null, limit = 100): Promise<{ users: CmsUser[]; next: string | null }> {
        const offset = after === null ? 0 : Math.max(Number(after) || 0, 0);
        const size = Math.min(Math.max(limit, 1), 200);
        const page = await this.#people.list({ limit: size, offset });
        const users = await this.#users(new Map(page.users.map(person => [person.id, person])));
        return { users: page.users.map(person => users.get(person.id)!), next: offset + page.users.length < page.total && page.users.length > 0 ? String(offset + page.users.length) : null };
    }
    override async awaitingApproval(): Promise<boolean> { return false; }
    override async confirmRegistration(): Promise<boolean> { return elsewhere('Confirming a registration'); }
    override async registrations(): Promise<{ user: CmsUser; verified: boolean; createdAt: number }[]> { return []; }
    override async registrationCount(): Promise<number> { return 0; }
    override async approve(): Promise<boolean> { return elsewhere('Approving a registration'); }
    override async convert(): Promise<CmsUser> { return elsewhere('Converting an account'); }
    override async setStatus(): Promise<boolean> { return elsewhere('Changing an account\'s status'); }
    override async setPassword(): Promise<boolean> { return elsewhere('Setting a password'); }
    override async createRole(): Promise<CmsRole> { return elsewhere('Making a role'); }
    override async updateRole(): Promise<boolean> { return elsewhere('Changing a role'); }
    override async deleteRole(): Promise<boolean> { return elsewhere('Deleting a role'); }
}

function cmsRole(role: PersonRole): CmsRole {
    return { id: role.id, name: role.name, permissions: [...role.permissions], createdAt: 0 };
}

/** A unique field of the user's document that another user's value holds. */
function fieldError(error: unknown): unknown {
    const name = error instanceof ClientError && error.outcome === 'rolled-back' ? uniqueFieldOf(error.message) : undefined;
    if (name !== undefined) return new CmsError('CMS_CONFLICT', 'Another user has the same value in a unique field.', name ? { fields: { [name]: 'is taken.' } } : {});
    return error;
}
