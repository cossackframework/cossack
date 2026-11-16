import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHookRegistry } from '@cossackframework/core/hooks';
import { beforeWrite, CmsError, contentModule, createCMS, type CmsHost, type Principal } from '../src/server/index';
import { romedbService, live } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };

describe.skipIf(!live)('scheduled entries that fail', () => {
    const service = romedbService();
    let clock = Date.UTC(2026, 10, 12, 9, 0);
    let cms: CmsHost;

    beforeAll(async () => {
        const hooks = createHookRegistry();
        cms = createCMS({ db: service.database(), modules: [contentModule], hooks, now: () => clock });
        // A plugin that refuses to publish entries titled "Refused", every time.
        hooks.addFilter(beforeWrite, (draft, { input }) => {
            if (String(input.previous?.title ?? '').startsWith('Refused') && draft.status === 'published') throw new CmsError('CMS_VALIDATION', 'Not this one.');
            return draft;
        }, { plugin: 'acme' });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
    }, 30_000);

    it('logs and passes over them, and publishes the rest, even past a full page of them', async () => {
        const posts = cms.resource('cms/posts');
        const at = clock + 60_000;
        for (let i = 0; i < 3; i++) await posts.create({ title: `Refused ${i}`, status: 'published', publishedAt: at - 10 + i }, { principal: admin });
        const kept = await posts.create({ title: 'Launch', status: 'published', publishedAt: at }, { principal: admin });
        clock = at + 1;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            // A page of two: both refused, so the run reads past them to the entry that publishes.
            expect(await cms.runSchedule({ limit: 2 })).toEqual({ published: 1, unpublished: 0 });
            expect(error).toHaveBeenCalledTimes(3);
        } finally { error.mockRestore(); }
        expect(await posts.get(kept.id, { principal: admin })).toMatchObject({ status: 'published' });
    });
});
