import { beforeAll, describe, expect, it } from 'vitest';
import { createCMS, type CmsHost } from '../src/server/index';
import { live, romedbService } from './helpers';

describe.skipIf(!live)('page view analytics', () => {
    const service = romedbService();
    let clock = Date.parse('2026-11-07T09:00:00Z');
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), now: () => clock });
        expect((await cms.migrate()).failed).toBeUndefined();
    }, 30_000);

    it('counts views, one visitor per day and referring sites, and leaves out what is not a page', async () => {
        const origin = 'https://site.example';
        expect(await cms.traffic.recordView({ path: '/posts/hello?utm=1', referrer: 'https://news.example/list', visitor: '10.0.0.1|Firefox', origin })).toBe(true);
        expect(await cms.traffic.recordView({ path: '/posts/hello', referrer: `${origin}/`, visitor: '10.0.0.1|Firefox', origin })).toBe(true);
        expect(await cms.traffic.recordView({ path: '/', referrer: '', visitor: '10.0.0.2|Safari', origin })).toBe(true);
        expect(await cms.traffic.recordView({ path: '/dashboard/posts', referrer: '', visitor: 'x', origin })).toBe(false);
        expect(await cms.traffic.recordView({ path: '/wp-login.php', referrer: '', visitor: 'x', origin })).toBe(false);
        const report = await cms.traffic.views(30);
        expect(report).toMatchObject({ views: 3, visitors: 2 });
        expect(report.days).toEqual([{ day: '2026-11-07', views: 3, visitors: 2 }]);
        expect(report.pages).toEqual([{ path: '/posts/hello', views: 2 }, { path: '/', views: 1 }]);
        expect(report.referrers).toEqual([{ host: 'news.example', count: 1 }]);
    });

    it('prunes old rows: views after a year, visitor hashes after a week', async () => {
        clock += 9 * 86_400_000;
        await cms.traffic.recordView({ path: '/later', referrer: '', visitor: '10.0.0.3|Chrome', origin: 'https://site.example' });
        await cms.traffic.prune();
        let report = await cms.traffic.views(30);
        expect(report.views).toBe(4);
        expect(report.visitors).toBe(1);
        clock += 370 * 86_400_000;
        await cms.traffic.prune();
        report = await cms.traffic.views(30);
        expect(report.views).toBe(0);
    });
});
