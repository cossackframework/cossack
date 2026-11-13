import { describe, expect, it, vi } from 'vitest';
import { userPrincipal } from '@cossackframework/cms';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('config', () => '/auth/login');
vi.mock('../src/services/users', () => ({ getUser: async (id: string) => ({ id, roles: [{ permissions: ['cms/posts:create'] }] }) }));
vi.mock('../src/cms/content-api', () => ({ writeAllowed: () => null, writeBody: async () => ({ meta: {} }), apiError: () => new Response(null, { status: 500 }) }));
vi.mock('../src/cms/content', () => ({ groupsView: async () => ({ fields: [] }), metaInput: () => ({ errors: {}, meta: {} }), metaValues: () => ({}) }));

const { POST } = await import('../src/pages/api/cms/users/[id]/meta');

/** A request signed in with an application password: a principal, no session user. */
function tokenRequest(permissions: string[]) {
    const vars: Record<string, unknown> = {
        principal: userPrincipal('manager', ['editor'], permissions),
        cms: { users: { update: async () => undefined, get: async () => ({ meta: {} }) } },
    };
    return { get: (key: string) => vars[key], req: { param: () => 'author' }, json: (body: unknown, status = 200) => Response.json(body, { status }) } as never;
}

describe('user meta API', () => {
    it('accepts an application password of someone who may change the account', async () => {
        const response = await POST(tokenRequest(['cms:users', 'cms/*']));
        expect(response.status).toBe(200);
    });

    it('still refuses a token whose holder is weaker than the account', async () => {
        const response = await POST(tokenRequest(['cms:users']));
        expect(response.status).toBe(404);
    });
});
