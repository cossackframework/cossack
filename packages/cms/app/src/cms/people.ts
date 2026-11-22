// The people port (`PeoplePort` of the CMS library) over the dashboard package's accounts:
// users, roles and their assignments are the ORM's tables in the site's database, read and
// written in the scope of the request (the site's own database on a site of a network).
//
// A role's ID is the ORM role's (`editor`), and its name what people read ("Editor").
import { In, sql } from '@cossackframework/database';
import { CmsError, type PeoplePort, type Person, type PersonRole } from '@cossackframework/cms/server';
import { hashPassword } from '@cossackframework/auth';
import { uuidv7 } from '#app/lib/uuid';
import { asMainAccount, accounts, currentTenant } from '#app/tenants';
import { User } from '@/models/User';
import { Role } from '@/models/Role';
import { UserRole } from '@/models/UserRole';

const ROLE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const AUTH_PURPOSE = JSON.stringify({ type: 'auth' });

function personRole(role: Role): PersonRole {
    return Object.freeze({ id: role.id, name: role.name, permissions: Object.freeze([...(role.permissions ?? [])].sort()) });
}

/** Members of this site as people: their roles here, and whether the account is a network administrator's. */
async function people(users: readonly User[]): Promise<Person[]> {
    if (!users.length) return [];
    const ids = users.map(user => user.id);
    const [assignments, roles, signIns, admins] = await Promise.all([
        UserRole.find({ where: { userId: In(ids) }, take: 5000 }),
        Role.find({ take: 500 }),
        sql<{ userId: string; at: string | null }>`SELECT user_id AS userId, MAX(created_at) AS at FROM sessions WHERE user_id IN (${ids}) AND meta = ${AUTH_PURPOSE} GROUP BY user_id`,
        // The flag is the account's, in the main database; on a site of a network the member row does not carry it.
        currentTenant() ? asMainAccount(() => accounts(() => User.find({ where: { id: In(ids), networkAdmin: true }, take: 500 }))) : Promise.resolve(users.filter(user => user.networkAdmin)),
    ]);
    const byId = new Map(roles.map(role => [role.id, personRole(role)]));
    const last = new Map(signIns.rows.map(row => [row.userId, row.at ? new Date(row.at).getTime() : null]));
    const network = new Set(admins.map(user => user.id));
    return users.map(user => Object.freeze({
        id: user.id, email: user.email, name: user.name ?? '', avatar: user.avatar,
        status: user.status === 'active' ? 'active' as const : 'disabled' as const,
        roles: Object.freeze(assignments.filter(entry => entry.userId === user.id).map(entry => byId.get(entry.roleId)).filter((role): role is PersonRole => role !== undefined).sort((a, b) => a.id < b.id ? -1 : 1)),
        networkAdmin: network.has(user.id),
        account: user.tenantAccount ? 'site' as const : 'network' as const,
        createdAt: user.createdAt.getTime(),
        lastSignInAt: last.get(user.id) ?? null,
    }));
}

async function roleIds(names: readonly string[]): Promise<string[]> {
    const unique = [...new Set(names)];
    if (!unique.length) return [];
    const found = await Role.find({ where: { id: In(unique) } });
    if (found.length !== unique.length) throw new CmsError('CMS_VALIDATION', 'Unknown role.');
    return found.map(role => role.id);
}

export const ormPeople: PeoplePort = {
    async getMany(ids) {
        const wanted = [...new Set(ids)].slice(0, 200);
        if (!wanted.length) return new Map();
        return new Map((await people(await User.find({ where: { id: In(wanted) } }))).map(person => [person.id, person]));
    },
    async findByEmail(email) {
        const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });
        return user ? (await people([user]))[0]! : null;
    },
    async list(options = {}) {
        const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
        const offset = Math.max(options.offset ?? 0, 0);
        const like = options.search?.trim() ? `%${options.search.trim().slice(0, 100).toLowerCase()}%` : null;
        const role = options.role ? await Role.findOne({ where: { id: options.role } }) : null;
        if (options.role && !role) return { users: [], total: 0 };
        const search = like ? sql.fragment`AND (LOWER(u.name) LIKE ${like} OR u.email LIKE ${like})` : sql.fragment``;
        const held = role ? sql.fragment`AND u.id IN (SELECT user_id FROM user_roles WHERE role_id = ${role.id})` : sql.fragment``;
        const [page, count] = await Promise.all([
            sql<{ id: string }>`SELECT u.id FROM users u WHERE 1 = 1 ${search} ${held} ORDER BY LOWER(u.name), u.id LIMIT ${limit} OFFSET ${offset}`,
            sql<{ total: number }>`SELECT COUNT(*) AS total FROM users u WHERE 1 = 1 ${search} ${held}`,
        ]);
        const ids = page.rows.map(row => row.id);
        const found = new Map((await people(ids.length ? await User.find({ where: { id: In(ids) } }) : [])).map(person => [person.id, person]));
        return { users: ids.map(id => found.get(id)).filter((person): person is Person => person !== undefined), total: Number(count.rows[0]?.total ?? 0) };
    },
    async count() { return User.count(); },
    async roles() { return (await Role.find({ order: { createdAt: 'asc' }, take: 500 })).map(personRole); },
    async role(id) {
        const role = await Role.findOne({ where: { id } });
        return role ? personRole(role) : null;
    },
    async defineRole(role) {
        if (!ROLE_ID.test(role.id) || !role.name.trim()) throw new CmsError('CMS_VALIDATION', 'A role needs an ID of lowercase letters and a name.');
        const permissions = [...new Set(role.permissions)].sort();
        if (await Role.exists({ id: role.id })) await Role.update({ id: role.id }, { name: role.name.trim(), permissions });
        else await Role.insert({ id: role.id, name: role.name.trim(), permissions, createdAt: new Date() });
        return personRole((await Role.findOne({ where: { id: role.id } }))!);
    },
    async create(input) {
        const email = input.email.trim().toLowerCase();
        if (!/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) throw new CmsError('CMS_VALIDATION', 'Enter a valid email address.', { fields: { email: 'is not valid.' } });
        if (await User.exists({ email })) throw new CmsError('CMS_CONFLICT', 'A user with this email already exists.', { fields: { email: 'is taken.' } });
        const roles = await roleIds(input.roles ?? []);
        const id = input.id ?? uuidv7();
        // On a site of a network a user made here is that site's own account.
        await User.insert({ id, email, name: input.name.trim() || email, passwordHash: input.password ? await hashPassword(input.password) : null, avatar: null, meta: null, status: 'active', tenantAccount: currentTenant() !== null, createdAt: new Date() });
        if (roles.length) await UserRole.insert(roles.map(roleId => ({ userId: id, roleId, createdAt: new Date() })));
        return (await people([(await User.findOne({ where: { id } }))!]))[0]!;
    },
    async update(id, patch) {
        const user = await User.findOne({ where: { id } });
        if (!user) return false;
        const values: Partial<User> = {};
        if (patch.name !== undefined) values.name = patch.name.trim() || user.name;
        if (patch.avatar !== undefined) values.avatar = patch.avatar;
        if (patch.email !== undefined) {
            const email = patch.email.trim().toLowerCase();
            if (email !== user.email && await User.exists({ email })) throw new CmsError('CMS_CONFLICT', 'A user with this email already exists.', { fields: { email: 'is taken.' } });
            values.email = email;
        }
        if (Object.keys(values).length) await User.update({ id }, values);
        return true;
    },
    async setRoles(id, names) {
        if (!await User.exists({ id })) throw new CmsError('CMS_NOT_FOUND', 'User not found.');
        const roles = await roleIds(names);
        await UserRole.delete({ userId: id });
        if (roles.length) await UserRole.insert(roles.map(roleId => ({ userId: id, roleId, createdAt: new Date() })));
    },
    async delete(id) {
        if (!await User.exists({ id })) return false;
        await UserRole.delete({ userId: id });
        await User.delete({ id });
        return true;
    },
};
