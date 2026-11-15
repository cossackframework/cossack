import { describe, expect, it } from 'vitest';
import { DEFAULT_RESERVED_PATHS } from '@cossackframework/cms/server';
import { reservedRouteSegments } from '../src/cms/reserved-paths';

describe('reserved first path segments', () => {
    it('takes the first static segment of every page file, whoever provides it', () => {
        expect(reservedRouteSegments([
            '/src/pages/(site)/index.ts',
            '/src/pages/(site)/[...path]/index.ts',
            '/src/pages/(site)/search/index.ts',
            '/src/pages/(site)/robots.txt/index.ts',
            '/src/pages/dashboard/(cms)/settings/index.ts',
            '/src/pages/api/cms/content/[collection]/index.ts',
            // The project's own pages, and a plugin's.
            '/src/pages/pricing/index.ts',
            '/src/pages/about.ts',
            '/src/pages/guide.md',
            '/src/pages/shop/[id]/index.ts',
            '/src/pages/404.ts',
            '/src/pages/error.ts',
            '/src/pages/[tenant]/index.ts',
        ])).toEqual(['about', 'api', 'dashboard', 'guide', 'pricing', 'robots.txt', 'search', 'shop']);
        expect(reservedRouteSegments([])).toEqual([]);
    });

    it('adds a project page to the addresses an entry cannot take', () => {
        const reservedPaths = [...DEFAULT_RESERVED_PATHS, ...reservedRouteSegments(['/src/pages/pricing/index.ts'])];
        expect(reservedPaths).toContain('pricing');
        expect(reservedPaths).toContain('dashboard');
    });
});
