import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { CmsError, type Principal } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
const { GET } = await import('../src/pages/api/cms/forms/[slug]/submissions/[submission]/files/[file]');

const editor: Principal = { kind: 'user', id: 'u1', roles: ['editor'], permissions: ['cms:submissions'] };
const visitor: Principal = { kind: 'anonymous' };

/** A host whose form has one submission with one private file; `file()` checks the permission as `CmsForms.file` does. */
function app(principal: Principal) {
    const calls: unknown[][] = [];
    const cms = {
        forms: {
            get: async (key: string) => key === 'jobs' ? { ref: { id: 'f1', slug: 'jobs' } } : null,
            file: async (form: unknown, submission: string, file: string, who: Principal) => {
                calls.push([submission, file]);
                if (who.kind !== 'user' || !who.permissions.includes('cms:submissions')) throw new CmsError(who.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to handle form submissions.');
                if (submission !== 's1' || file !== 'file1') return null;
                return { file: { id: 'file1', name: 'my cv.pdf', contentType: 'application/pdf', size: 4 }, body: new Response('%PDF').body! };
            },
        },
    } as unknown as CmsHost;
    const server = new Hono();
    server.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, principal as never); await next(); });
    server.get('/api/cms/forms/:slug/submissions/:submission/files/:file', GET as never);
    return { request: (path: string) => server.request(path), calls };
}

describe('a form file download', () => {
    it('sends the file as a private download to those who handle submissions', async () => {
        const { request, calls } = app(editor);
        const response = await request('/api/cms/forms/jobs/submissions/s1/files/file1');
        expect(response.status).toBe(200);
        expect(calls).toEqual([['s1', 'file1']]);
        expect(Object.fromEntries(response.headers)).toMatchObject({
            'content-type': 'application/pdf', 'content-length': '4', 'content-disposition': "attachment; filename*=UTF-8''my%20cv.pdf",
            'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
        });
        expect(await response.text()).toBe('%PDF');
    });

    it('answers 404 for a missing form, submission or file', async () => {
        const { request } = app(editor);
        expect((await request('/api/cms/forms/nothing/submissions/s1/files/file1')).status).toBe(404);
        expect((await request('/api/cms/forms/jobs/submissions/s2/files/file1')).status).toBe(404);
        expect((await request('/api/cms/forms/jobs/submissions/s1/files/other')).status).toBe(404);
    });

    it('refuses visitors and people who do not handle submissions', async () => {
        const anonymous = await app(visitor).request('/api/cms/forms/jobs/submissions/s1/files/file1');
        expect(anonymous.status).toBe(401);
        expect(await anonymous.json()).toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
        const author = await app({ kind: 'user', id: 'u2', roles: ['author'], permissions: ['cms:upload'] }).request('/api/cms/forms/jobs/submissions/s1/files/file1');
        expect(author.status).toBe(403);
    });
});
