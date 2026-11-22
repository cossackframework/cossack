// What the network's screens ask about accounts across sites. Accounts are the main database's
// users (the dashboard package's), and memberships its `tenant_members`.
import { In, sql } from '@cossackframework/database';
import { hashPassword } from '@cossackframework/auth';
import { ClientVisibleError } from '@cossackframework/core';
import { MAIN_SITE, NETWORK_ADMIN } from '@cossackframework/cms';
import { accounts, asMainAccount } from '#app/tenants';
import { uuidv7 } from '#app/lib/uuid';
import { changeUserPassword, deleteUser, setUserStatus } from '#app/services/users';
import { requireAnotherNetworkAdmin } from '#app/services/tenants';
import { User } from '@/models/User';
import { TenantMember } from '@/models/TenantMember';

const main = <T>(work: () => Promise<T>): Promise<T> => asMainAccount(() => accounts(work));

/** How many network accounts are members of each added site. */
export function siteMemberCounts(): Promise<Map<string, number>> {
    return main(async () => {
        const counts = new Map<string, number>();
        for (const member of await TenantMember.find({ take: 50_000 })) counts.set(member.tenantId, (counts.get(member.tenantId) ?? 0) + 1);
        return counts;
    });
}

/** The added sites each of these accounts is a member of. */
export function siteMemberships(accountIds: readonly string[]): Promise<Map<string, string[]>> {
    return main(async () => {
        const found = new Map<string, string[]>();
        if (!accountIds.length) return found;
        for (const member of await TenantMember.find({ where: { userId: In([...accountIds]) }, take: 50_000 })) found.set(member.userId, [...(found.get(member.userId) ?? []), member.tenantId]);
        return found;
    });
}

/** The IDs of the network's administrators. */
export function networkAdminIds(): Promise<Set<string>> {
    return main(async () => new Set((await User.find({ where: { networkAdmin: true }, take: 1000 })).map(user => user.id)));
}

/** An account of the network, as the network's screens show it. */
export interface NetworkAccount {
    id: string; email: string; name: string; status: 'active' | 'disabled';
    networkRole: typeof NETWORK_ADMIN | null; createdAt: number; lastSignInAt: number | null;
}

const AUTH_PURPOSE = JSON.stringify({ type: 'auth' });

async function shaped(users: readonly User[]): Promise<NetworkAccount[]> {
    if (!users.length) return [];
    const ids = users.map(user => user.id);
    const signIns = await sql<{ userId: string; at: string | null }>`SELECT user_id AS userId, MAX(created_at) AS at FROM sessions WHERE user_id IN (${ids}) AND meta = ${AUTH_PURPOSE} GROUP BY user_id`;
    const last = new Map(signIns.rows.map(row => [row.userId, row.at ? new Date(row.at).getTime() : null]));
    return users.map(user => ({ id: user.id, email: user.email, name: user.name ?? '', status: user.status === 'active' ? 'active' as const : 'disabled' as const,
        networkRole: user.networkAdmin ? NETWORK_ADMIN : null, createdAt: user.createdAt.getTime(), lastSignInAt: last.get(user.id) ?? null }));
}

/**
 * The network's accounts: the main database's users. Each is a user of the main site, and a
 * member of the added sites `tenant_members` names. For the network's screens, on the network host.
 */
export const networkAccounts = {
    get: (id: string) => main(async () => (await shaped(await User.find({ where: { id } })))[0] ?? null),
    findByEmail: (email: string) => main(async () => (await shaped(await User.find({ where: { email: email.trim().toLowerCase() } })))[0] ?? null),
    count: () => main(() => User.count()),
    /** Newest first. `search` matches a name or an email. */
    list: (options: { search?: string; networkAdmins?: boolean; limit?: number; offset?: number } = {}) => main(async () => {
        const like = options.search?.trim() ? `%${options.search.trim().slice(0, 100).toLowerCase()}%` : null;
        const search = like ? sql.fragment`AND (LOWER(u.name) LIKE ${like} OR u.email LIKE ${like})` : sql.fragment``;
        const admins = options.networkAdmins ? sql.fragment`AND u.network_admin = ${true}` : sql.fragment``;
        const [page, count] = await Promise.all([
            sql<{ id: string }>`SELECT u.id FROM users u WHERE 1 = 1 ${search} ${admins} ORDER BY u.created_at DESC, u.id LIMIT ${Math.min(Math.max(options.limit ?? 20, 1), 100)} OFFSET ${Math.max(options.offset ?? 0, 0)}`,
            sql<{ total: number }>`SELECT COUNT(*) AS total FROM users u WHERE 1 = 1 ${search} ${admins}`,
        ]);
        const ids = page.rows.map(row => row.id);
        const found = new Map((await shaped(ids.length ? await User.find({ where: { id: In(ids) } }) : [])).map(account => [account.id, account]));
        return { items: ids.map(id => found.get(id)).filter((account): account is NetworkAccount => account !== undefined), total: Number(count.rows[0]?.total ?? 0) };
    }),
    /** The sites each account is a member of: the main site, and the added sites that have it as a member. */
    memberships: async (ids: readonly string[]) => {
        const added = await siteMemberships(ids);
        return new Map(ids.map(id => [id, [MAIN_SITE, ...(added.get(id) ?? [])]]));
    },
    create: (input: { email: string; name: string; password: string; networkRole?: typeof NETWORK_ADMIN }) => main(async () => {
        const email = input.email.trim().toLowerCase();
        if (!/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) throw new ClientVisibleError('Enter a valid email address.');
        if (input.password.length < 8) throw new ClientVisibleError('Enter a password of at least 8 characters.');
        if (await User.exists({ email })) throw new ClientVisibleError('An account with this email already exists.');
        const id = uuidv7();
        await User.insert({ id, email, name: input.name.trim() || email, passwordHash: await hashPassword(input.password), avatar: null, meta: null, status: 'active', networkAdmin: input.networkRole === NETWORK_ADMIN, createdAt: new Date() });
        return (await shaped(await User.find({ where: { id } })))[0]!;
    }),
    update: (id: string, patch: { name?: string; email?: string }) => main(async () => {
        const values: Partial<User> = {};
        if (patch.name !== undefined && patch.name.trim()) values.name = patch.name.trim();
        if (patch.email !== undefined && patch.email.trim()) {
            const email = patch.email.trim().toLowerCase();
            if ((await User.findOne({ where: { email } }))?.id !== id && await User.exists({ email })) throw new ClientVisibleError('An account with this email already exists.');
            values.email = email;
        }
        if (Object.keys(values).length) await User.update({ id }, values);
    }),
    setPassword: (id: string, password: string) => main(() => changeUserPassword(id, password)),
    setNetworkRole: (id: string, role: typeof NETWORK_ADMIN | null) => main(async () => {
        if (role === null) await requireAnotherNetworkAdmin(id, 'left without the role');
        await User.update({ id }, { networkAdmin: role === NETWORK_ADMIN });
    }),
    /** Suspending ends the account's sessions on the network host; a suspended account is a guest on every site. */
    setStatus: (id: string, status: 'active' | 'disabled') => main(() => setUserStatus(id, status)),
    /** Delete the account. Its member rows on added sites stay as rows nobody can sign in to, and are removed with the member there. */
    delete: (id: string) => main(async () => { await deleteUser(id); return true; }),
};
