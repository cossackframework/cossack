import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { CmsHost } from '@cossackframework/cms/server';
import { CmsError } from '@cossackframework/cms';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
const { POST } = await import('../src/pages/api/cms/forms/[slug]/index');

/** A published form with a multiple input; one-time results and attempt counts are kept in memory. */
function app() {
    const saved: unknown[] = [];
    const counts = new Map<string, number>();
    const cms = {
        forms: {
            get: async (slug: string) => slug === 'signup'
                ? { published: true, ref: { id: 'f1', slug: 'signup', inputs: [{ name: 'tags', kind: 'string', multiple: true, data: {} }] }, settings: { closedMessage: '' } }
                : null,
            saveResult: async (_form: string, result: unknown) => { saved.push(result); return `k${saved.length}`; },
            // A submission with the tag "bad" fails validation; any other is accepted.
            submit: async (_form: string, values: Record<string, unknown>) => {
                if (JSON.stringify(values).includes('bad')) throw new CmsError('CMS_VALIDATION', 'Check the fields marked below.', { fields: { tags: 'is not allowed.' } });
                return { confirmation: { kind: 'message', message: 'Thanks.' }, submission: { id: 's1' } };
            },
        },
        security: {
            attempt: async (kind: string, key: string, max: number) => {
                const next = (counts.get(`${kind}:${key}`) ?? 0) + 1;
                counts.set(`${kind}:${key}`, Math.min(next, max));
                return next <= max;
            },
        },
    } as unknown as CmsHost;
    const server = new Hono();
    server.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, { kind: 'anonymous' } as never); await next(); });
    server.post('/api/cms/forms/:slug', POST as never);
    const post = (fields: Record<string, string>) => {
        const body = new FormData();
        for (const [name, value] of Object.entries(fields)) body.append(name, value);
        return server.request('http://localhost/api/cms/forms/signup', { method: 'POST', body, headers: { origin: 'http://localhost' } });
    };
    return { post, saved };
}

describe('a form post that stores a one-time result', () => {
    it('stores at most a window\'s worth of results per address, before any bot check, and then returns plainly', async () => {
        const { post, saved } = app();
        const first = await post({ _page: '/join', _add: 'tags' });
        expect(first.status).toBe(303);
        expect(first.headers.get('location')).toBe('/join?form=signup&result=k1#form-signup');
        for (let i = 0; i < 70; i++) await post({ _page: '/join', _add: 'tags' });
        expect(saved).toHaveLength(60);
        const late = await post({ _page: '/join', _remove: 'tags.1' });
        expect(late.headers.get('location')).toBe('/join#form-signup');
        expect(saved).toHaveLength(60);
    });

    it('still shows a visitor their errors and confirmation after list edits used up the address', async () => {
        const { post, saved } = app();
        for (let i = 0; i < 70; i++) await post({ _page: '/join', _add: 'tags' });
        expect(saved).toHaveLength(60);
        const refused = await post({ _page: '/join', tags: 'bad' });
        expect(refused.headers.get('location')).toBe('/join?form=signup&result=k61#form-signup');
        expect(saved.at(-1)).toMatchObject({ kind: 'error', errors: { tags: 'is not allowed.' } });
        const sent = await post({ _page: '/join', tags: 'good' });
        expect(sent.headers.get('location')).toBe('/join?form=signup&result=k62#form-signup');
        expect(saved.at(-1)).toMatchObject({ kind: 'success' });
    });

    it('stores errors to a limit of their own, and confirmations without one', async () => {
        const { post, saved } = app();
        for (let i = 0; i < 65; i++) await post({ _page: '/join', tags: 'bad' });
        expect(saved).toHaveLength(60);
        await post({ _page: '/join', tags: 'good' });
        expect(saved).toHaveLength(61);
    });
});
