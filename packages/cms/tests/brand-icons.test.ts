import { describe, expect, it } from 'vitest';
import * as generated from '../src/server/brand-icons';
import { BRAND_SLUGS, brandIcons, exportName } from '../scripts/brand-icons.mjs';

describe('the brand icons copied from simple-icons', () => {
    it('are current: every icon the resolver uses matches the package', () => {
        const fresh = Object.fromEntries(brandIcons() as [string, { title: string; slug: string; hex: string; path: string }][]);
        for (const slug of BRAND_SLUGS as string[]) {
            const name = exportName(slug) as keyof typeof generated;
            expect(generated[name], `${slug}: run pnpm --filter @cossackframework/cms brands`).toEqual(fresh[name]);
        }
        expect(Object.keys(generated).filter(key => key.startsWith('si'))).toHaveLength(BRAND_SLUGS.length);
    });
});
