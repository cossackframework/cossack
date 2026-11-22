// The people port: what the CMS needs from whoever keeps accounts, roles and sign-in.
//
// The CMS does not keep accounts itself. The application fills this port from the dashboard
// package's services (`specs/cms-on-dashboard.md`), and the CMS keeps only what is its own
// about a user, beside the port's record and under the same ID: the author slug and the
// values of the field groups attached to users.
import { CmsError } from '../errors';

/** A role as the port gives it. `id` is what settings, rules and permissions name: `admin`, `editor`. */
export interface PersonRole {
    readonly id: string;
    /** The name people read, such as "Editor". */
    readonly name: string;
    readonly permissions: readonly string[];
}

/** A user of this site, as the port gives them. */
export interface Person {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly avatar: string | null;
    readonly status: 'active' | 'disabled';
    /** The roles the user holds on this site, in ID order. */
    readonly roles: readonly PersonRole[];
    /** A network administrator: every permission on every site, whatever roles the site gave. */
    readonly networkAdmin: boolean;
    /** `site`: an account of this site only. `network`: an account every site of the network shares. */
    readonly account: 'site' | 'network';
    readonly createdAt: number;
    /** When the user last started a session on this site, or null when never. */
    readonly lastSignInAt: number | null;
}

export interface PeopleListOptions {
    /** Part of a name or an email. */
    readonly search?: string;
    /** Only holders of this role. */
    readonly role?: string;
    /** Default 50, at most 200. */
    readonly limit?: number;
    readonly offset?: number;
}

export interface PersonInput {
    readonly email: string;
    readonly name: string;
    /** Without one the account cannot sign in with a password until it sets one. */
    readonly password?: string;
    readonly roles?: readonly string[];
    readonly id?: string;
}

/**
 * Accounts, members and roles of one site. Every method is about this site: `list` gives its
 * members, `roles` its roles. A user who is not a member of the site is not found.
 */
export interface PeoplePort {
    /** The users with these IDs. Unknown IDs are left out. At most 200 a call. */
    getMany(ids: readonly string[]): Promise<Map<string, Person>>;
    findByEmail(email: string): Promise<Person | null>;
    /** By name, then ID. */
    list(options?: PeopleListOptions): Promise<{ readonly users: readonly Person[]; readonly total: number }>;
    count(): Promise<number>;
    roles(): Promise<readonly PersonRole[]>;
    role(id: string): Promise<PersonRole | null>;
    /** Make the role, or give an existing one these permissions: the CMS's and plugins' default roles. */
    defineRole(role: PersonRole): Promise<PersonRole>;
    /** Throws `CMS_CONFLICT` when the email is taken and `CMS_VALIDATION` for an unknown role. */
    create(input: PersonInput): Promise<Person>;
    /** False when there is no such user. */
    update(id: string, patch: { readonly name?: string; readonly email?: string; readonly avatar?: string | null }): Promise<boolean>;
    setRoles(id: string, roles: readonly string[]): Promise<void>;
    /** False when there is no such user. */
    delete(id: string): Promise<boolean>;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const ROLE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * A people port that keeps everything in memory: for tests, and for trying the CMS without
 * an application around it. It follows the rules an application's port must follow.
 */
export function memoryPeople(options: { now?: () => number } = {}): PeoplePort & { /** Mark a user as a network administrator, or as disabled. */ set(id: string, patch: { networkAdmin?: boolean; status?: 'active' | 'disabled'; lastSignInAt?: number | null }): void } {
    const now = options.now ?? Date.now;
    const users = new Map<string, Omit<Person, 'roles'> & { roles: string[] }>();
    const roles = new Map<string, PersonRole>();
    let made = 0;

    const person = (id: string): Person | null => {
        const user = users.get(id);
        if (!user) return null;
        const held = user.roles.map(role => roles.get(role)).filter((role): role is PersonRole => role !== undefined).sort((a, b) => a.id < b.id ? -1 : 1);
        return Object.freeze({ ...user, roles: Object.freeze(held) });
    };
    const checkRoles = (ids: readonly string[]): string[] => {
        const unique = [...new Set(ids)];
        if (unique.some(id => !roles.has(id))) throw new CmsError('CMS_VALIDATION', 'Unknown role.');
        return unique;
    };
    const email = (value: string): string => {
        const normal = value.trim().toLowerCase();
        if (!EMAIL.test(normal)) throw new CmsError('CMS_VALIDATION', 'Enter a valid email address.', { fields: { email: 'is not valid.' } });
        return normal;
    };

    return {
        async getMany(ids) {
            return new Map([...new Set(ids)].slice(0, 200).map(id => [id, person(id)] as const).filter((entry): entry is [string, Person] => entry[1] !== null));
        },
        async findByEmail(value) {
            const normal = value.trim().toLowerCase();
            for (const user of users.values()) if (user.email === normal) return person(user.id);
            return null;
        },
        async list(listOptions = {}) {
            const search = listOptions.search?.trim().toLowerCase();
            const matching = [...users.values()]
                .filter(user => !search || user.name.toLowerCase().includes(search) || user.email.includes(search))
                .filter(user => !listOptions.role || user.roles.includes(listOptions.role))
                .sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.id < b.id ? -1 : 1);
            const offset = Math.max(listOptions.offset ?? 0, 0);
            const limit = Math.min(Math.max(listOptions.limit ?? 50, 1), 200);
            return { users: matching.slice(offset, offset + limit).map(user => person(user.id)!), total: matching.length };
        },
        async count() { return users.size; },
        async roles() { return [...roles.values()].sort((a, b) => a.id < b.id ? -1 : 1); },
        async role(id) { return roles.get(id) ?? null; },
        async defineRole(role) {
            if (!ROLE_ID.test(role.id) || !role.name.trim()) throw new CmsError('CMS_VALIDATION', 'A role needs an ID of lowercase letters and a name.');
            const defined = Object.freeze({ id: role.id, name: role.name.trim(), permissions: Object.freeze([...new Set(role.permissions)].sort()) });
            roles.set(role.id, defined);
            return defined;
        },
        async create(input) {
            const address = email(input.email);
            if ([...users.values()].some(user => user.email === address)) throw new CmsError('CMS_CONFLICT', 'A user with this email already exists.', { fields: { email: 'is taken.' } });
            const id = input.id ?? `person-${String(++made).padStart(4, '0')}`;
            if (users.has(id)) throw new CmsError('CMS_CONFLICT', 'A user with this ID already exists.');
            users.set(id, { id, email: address, name: input.name.trim() || address, avatar: null, status: 'active', roles: checkRoles(input.roles ?? []), networkAdmin: false, account: 'site', createdAt: now(), lastSignInAt: null });
            return person(id)!;
        },
        async update(id, patch) {
            const user = users.get(id);
            if (!user) return false;
            const address = patch.email === undefined ? user.email : email(patch.email);
            if ([...users.values()].some(other => other.id !== id && other.email === address)) throw new CmsError('CMS_CONFLICT', 'A user with this email already exists.', { fields: { email: 'is taken.' } });
            users.set(id, { ...user, email: address, ...(patch.name === undefined ? {} : { name: patch.name.trim() || user.name }), ...(patch.avatar === undefined ? {} : { avatar: patch.avatar }) });
            return true;
        },
        async setRoles(id, ids) {
            const user = users.get(id);
            if (!user) throw new CmsError('CMS_NOT_FOUND', 'User not found.');
            users.set(id, { ...user, roles: checkRoles(ids) });
        },
        async delete(id) { return users.delete(id); },
        set(id, patch) {
            const user = users.get(id);
            if (user) users.set(id, { ...user, ...patch });
        },
    };
}

/** The permission patterns a person holds: every role's, or everything for a network administrator. */
export function personPermissions(person: Pick<Person, 'roles' | 'networkAdmin'>): string[] {
    if (person.networkAdmin) return ['*'];
    return [...new Set(person.roles.flatMap(role => role.permissions))].sort();
}
