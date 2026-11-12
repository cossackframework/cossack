import { describe, expect, it, vi } from 'vitest';
import type { CmsHost, Principal } from '@cossackframework/cms/server';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('__', (text: string) => text);

const { mentionableUsers } = await import('../src/cms/site-editing');

const users = [
    { id: 'me', name: 'Me', email: 'me@example.com', status: 'active' },
    { id: 'ada', name: 'Ada', email: 'ada@example.com', status: 'active' },
    { id: 'member', name: '', email: 'member@example.com', status: 'active' },
    { id: 'gone', name: 'Gone', email: 'gone@example.com', status: 'disabled' },
];
const host = { users: { list: async () => ({ items: users }) } } as unknown as CmsHost;
const contributor: Principal = { kind: 'user', id: 'me', roles: ['contributor'], permissions: ['cms/posts:create', 'cms/posts:update'] };
const admin: Principal = { kind: 'user', id: 'me', roles: ['admin'], permissions: ['*'] };

describe('who a note may mention', () => {
    it('lists active users by name, with no email addresses for a viewer who may not manage users', async () => {
        const list = await mentionableUsers(host, contributor);
        expect(list).toEqual([{ id: 'ada', name: 'Ada' }, { id: 'member', name: 'Unnamed user' }]);
        expect(JSON.stringify(list)).not.toContain('@');
    });

    it('shows a nameless user by email to a viewer who manages users, and nobody to a visitor', async () => {
        expect(await mentionableUsers(host, admin)).toContainEqual({ id: 'member', name: 'member@example.com' });
        expect(await mentionableUsers(host, { kind: 'anonymous' })).toEqual([]);
    });
});
