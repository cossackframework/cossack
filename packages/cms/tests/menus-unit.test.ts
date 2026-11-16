import { describe, expect, it } from 'vitest';
import type { RomeDB, Statement } from '@cossackframework/romedb';
import { CmsMenus } from '../src/server/menus';
import type { MenuItem, ResolvedMenuItem } from '../src/menus';

const link = (id: string, label: string, url: string): MenuItem => ({ id, kind: 'link', label, url, children: [] } as unknown as MenuItem);

/** A database holding three menu locations, counting the reads it is asked for. */
function database(reads: Statement[][]): RomeDB {
    const rows = [
        ['footer', JSON.stringify([link('f1', 'Privacy', '/privacy')])],
        ['legal', JSON.stringify([link('l1', 'Terms', '/terms')])],
        ['primary', JSON.stringify([link('p1', 'Home', '/'), link('p2', 'About', '/about')])],
    ];
    return { read: async (statements: Statement[]) => { reads.push(statements); return { sequence: 1n, results: [{ rows, columns: [] }] }; } } as unknown as RomeDB;
}

describe('menus for visitors', () => {
    it('reads every location in one query and resolves the menus side by side', async () => {
        const reads: Statement[][] = [];
        let running = 0;
        let most = 0;
        const resolve = async (items: readonly MenuItem[]): Promise<ResolvedMenuItem[]> => {
            running++; most = Math.max(most, running);
            await new Promise(done => setTimeout(done, 5));
            running--;
            return items.map(item => ({ ...item, url: (item as { url: string }).url }) as unknown as ResolvedMenuItem);
        };
        let now = 1_000;
        const menus = new CmsMenus(database(reads), { resolve, now: () => now });
        expect((await menus.forLocation('primary'))?.map(item => item.label)).toEqual(['Home', 'About']);
        // The page's other menus are resolved already: no read, no waiting on one another.
        expect((await menus.forLocation('footer'))?.map(item => item.label)).toEqual(['Privacy']);
        expect((await menus.forLocation('legal'))?.map(item => item.label)).toEqual(['Terms']);
        expect(await menus.forLocation('mobile')).toBeNull();
        expect(reads).toHaveLength(1);
        expect(most).toBe(3);
        // Cached until the time to live passes; then one read again for all of them.
        now += 31_000;
        await menus.forLocation('footer');
        await menus.forLocation('primary');
        expect(reads).toHaveLength(2);
        // A write anywhere forgets both the locations and the resolved menus.
        menus.refresh();
        await menus.forLocation('legal');
        expect(reads).toHaveLength(3);
    });
});
