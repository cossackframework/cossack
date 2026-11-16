import { describe, expect, it } from 'vitest';
import { applyDashboardMenu, dashboardLinkModuleId, dashboardMenuOf, dashboardMenuProblems, EMPTY_DASHBOARD_MENU } from '../src/dashboard-menu';

const modules = [{ id: 'collection-posts' }, { id: 'media' }, { id: 'comments' }, { id: 'appearance' }, { id: 'site-settings' }];
const link = (entry: { id: string; label: string; href: string }) => ({ id: dashboardLinkModuleId(entry) });

describe('dashboard menu', () => {
    it('checks the shape', () => {
        expect(dashboardMenuProblems(null)).toEqual([]);
        expect(dashboardMenuProblems({ order: ['media', 'collection-posts'], hidden: ['comments'], links: [{ id: 'docs', label: 'Docs', href: 'https://docs.example' }, { id: 'help', label: 'Help', href: '/dashboard/tools/health', icon: 'lightbulb' }] })).toEqual([]);
        expect(dashboardMenuProblems([])).toEqual(['The dashboard menu must be an object.']);
        expect(dashboardMenuProblems({ order: ['a', 'a'], hidden: [3], links: [{ id: 'bad id', label: '', href: 'javascript:alert(1)' }, { id: 'x', label: 'X', href: '//evil' }, { id: 'x', label: 'X', href: 'ok path' }], extra: 1 })).toEqual([
            'order repeats a module.', 'hidden lists up to 200 module IDs.',
            'Link 1: the ID is letters, digits, - and _.', 'Link 1: a label of 1 to 60 characters.', 'Link 1: the address must be a path on this site or an http(s) URL.',
            'Link 2: the address must not start with //.',
            'Link 3: the ID x is used twice.', 'Link 3: the address has spaces or quotes.',
            'extra is not part of the dashboard menu.']);
    });

    it('reads a stored value, falling back to the empty menu', () => {
        expect(dashboardMenuOf(null)).toBe(EMPTY_DASHBOARD_MENU);
        expect(dashboardMenuOf({ order: ['x', 'x'] })).toBe(EMPTY_DASHBOARD_MENU);
        expect(dashboardMenuOf({ hidden: ['media'] })).toEqual({ order: [], hidden: ['media'], links: [] });
    });

    it('hides, orders and adds links; unlisted modules keep their order after the listed ones', () => {
        const menu = dashboardMenuOf({ order: ['link-docs', 'appearance', 'collection-posts'], hidden: ['comments', 'unknown'], links: [{ id: 'docs', label: 'Docs', href: 'https://docs.example' }] });
        expect(applyDashboardMenu(modules, menu, link).map(module => module.id)).toEqual(['link-docs', 'appearance', 'collection-posts', 'media', 'site-settings']);
        // The empty menu changes nothing.
        expect(applyDashboardMenu(modules, EMPTY_DASHBOARD_MENU, link)).toEqual(modules);
        // A module the user does not have is not conjured by the order.
        expect(applyDashboardMenu([{ id: 'media' }], menu, link).map(module => module.id)).toEqual(['link-docs', 'media']);
    });
});
