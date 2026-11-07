import { describe, expect, it, vi } from 'vitest';
import { field, type SettingsGroup } from '../../src/index';
import type { CmsHost } from '../../src/server';
import { settingsSearchEntries, searchSettings, settingsSectionId } from '../src/cms/settings-search';
import { filterSettingsLinks, settingsLinks } from '../src/cms/settings-nav';

function fixture() {
    const all = vi.fn(() => { throw new Error('Search must not load stored values.'); });
    const groups: SettingsGroup[] = [
        { id: 'general', label: 'General', json: true, fields: { siteTitle: field.string({ label: 'Site title', description: 'The public name of this site.' }) } },
        { id: 'seo', label: 'SEO', fields: {} },
        { id: 'crawlers', label: 'Crawlers', parent: 'seo', fields: { allowAiTraining: field.boolean({ label: 'AI training', description: 'Allow GPTBot.' }) } },
        { id: 'languages', label: 'Languages', fields: { default: field.string({ label: 'Default language' }), others: field.string({ label: 'Other languages' }) } },
        { id: 'custom', label: 'Custom', fields: { format: { ...field.enum(['short', 'full'], { label: 'Format' }), choices: { full: 'Full content' } } } },
        { id: 'appearance', label: 'Appearance', permission: 'cms:appearance', fields: { theme: field.string({ label: 'Theme' }) } },
        { id: 'private', label: 'Private', permission: 'app:private', fields: { token: field.string({ label: 'Private token' }) } },
        { id: 'plugin:newsletter', plugin: 'newsletter', label: 'Mail delivery', description: 'Send announcements.', json: true,
            sections: [{ id: 'delivery', label: 'Delivery', description: 'Schedule outgoing messages.' }],
            fields: { enabled: { ...field.boolean({ label: 'Enabled' }), section: 'delivery' } } },
        { id: 'plugin:receipts', plugin: 'receipts', label: 'Receipts', json: true, fields: { enabled: field.boolean({ label: 'Enabled' }) } },
    ];
    const cms = { settings: { groups, all, catalog: () => groups.filter(group => group.json) }, taxonomies: { declarations: [
        { name: 'categories', label: 'Categories', singular: 'Category', path: 'category' },
        { name: 'topics', label: 'Topics', singular: 'Topic', path: 'topic' },
        { name: 'internal', label: 'Internal', singular: 'Internal' },
    ] } } as unknown as CmsHost;
    return { cms, all };
}

describe('global settings search', () => {
    it('finds ordinary, plugin, non-JSON and specialized settings without reading saved values', () => {
        const { cms, all } = fixture();
        const entries = settingsSearchEntries(cms);
        expect(searchSettings(entries, 'site title').map(entry => entry.id)).toEqual(['general.siteTitle']);
        expect(searchSettings(entries, 'newsletter enabled').map(entry => entry.id)).toEqual(['plugin:newsletter.enabled']);
        expect(searchSettings(entries, 'default language').map(entry => entry.id)).toEqual(['languages.default']);
        expect(searchSettings(entries, 'full content').map(entry => entry.id)).toEqual(['custom.format']);
        expect(searchSettings(entries, 'short').map(entry => entry.id)).toEqual(['custom.format']);
        expect(searchSettings(entries, 'permalinks topic').map(entry => entry.id)).toEqual(['permalinks.taxonomy.topics']);
        expect(all).not.toHaveBeenCalled();
    });

    it('matches keys, parent and section context, descriptions, and all query terms regardless of case', () => {
        const { cms } = fixture();
        const entries = settingsSearchEntries(cms);
        expect(searchSettings(entries, ' GENERAL.SITETITLE ').map(entry => entry.id)).toEqual(['general.siteTitle']);
        expect(searchSettings(entries, 'seo GPTBot').map(entry => entry.id)).toEqual(['crawlers.allowAiTraining']);
        expect(searchSettings(entries, 'plugins outgoing').map(entry => entry.id)).toEqual(['plugin:newsletter.enabled']);
        expect(searchSettings(entries, 'general newsletter')).toEqual([]);
        expect(searchSettings(entries, '   ')).toEqual(entries);
    });

    it('links to persistent section shells and identifies each matching field for DOM filtering', () => {
        const { cms } = fixture();
        const entries = settingsSearchEntries(cms);
        const href = (id: string) => entries.find(entry => entry.id === id)!.href;
        expect(href('general.siteTitle')).toBe('/dashboard/settings#settings-general');
        const plugin = new URL(href('plugin:newsletter.enabled'), 'https://example.test');
        expect(plugin.pathname).toBe('/dashboard/settings');
        expect(plugin.search).toBe('');
        expect(decodeURIComponent(plugin.hash.slice(1))).toBe(settingsSectionId('plugin:newsletter'));
        expect(href('languages.default')).toBe('/dashboard/settings#settings-languages');
        expect(href('languages.others')).toBe('/dashboard/settings#settings-languages');
        expect(href('permalinks.postsBase')).toBe('/dashboard/settings#settings-permalinks');
        expect(href('permalinks.category')).toBe('/dashboard/settings#settings-permalinks');
        expect(href('permalinks.taxonomy.categories')).toBe('/dashboard/settings#settings-permalinks');
        expect(entries.find(entry => entry.id === 'plugin:newsletter.enabled')).toMatchObject({ groupId: 'plugin:newsletter', name: 'enabled' });
        expect(entries.find(entry => entry.id === 'permalinks.taxonomy.categories')).toMatchObject({ groupId: 'permalinks', name: 'taxonomy.categories' });
    });

    it('omits groups outside the Settings routes and taxonomy bases without an archive route', () => {
        const { cms } = fixture();
        const entries = settingsSearchEntries(cms);
        expect(entries.some(entry => entry.id.startsWith('appearance.'))).toBe(false);
        expect(entries.some(entry => entry.id.startsWith('private.'))).toBe(false);
        expect(entries.some(entry => entry.id === 'permalinks.taxonomy.internal')).toBe(false);
        expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
    });

    it('gives each plugin a submenu and keeps parent headings while counting only matching fields', () => {
        const { cms } = fixture();
        const entries = settingsSearchEntries(cms);
        const links = settingsLinks(cms);
        expect(links.filter(link => link.parent === 'plugins').map(link => link.id)).toEqual(['plugin:newsletter', 'plugin:receipts']);
        expect(links.find(link => link.id === 'crawlers')?.parent).toBe('seo');
        expect(filterSettingsLinks(links, entries, 'plugins enabled').map(({ id, count }) => ({ id, count }))).toEqual([
            { id: 'plugins', count: 2 }, { id: 'plugin:newsletter', count: 1 }, { id: 'plugin:receipts', count: 1 },
        ]);
        expect(filterSettingsLinks(links, entries, 'outgoing').map(({ id, count }) => ({ id, count }))).toEqual([
            { id: 'plugins', count: 1 }, { id: 'plugin:newsletter', count: 1 },
        ]);
        expect(filterSettingsLinks(links, entries, 'GPTBot').map(({ id, count }) => ({ id, count }))).toEqual([
            { id: 'seo', count: 1 }, { id: 'crawlers', count: 1 },
        ]);
    });

    it('adds the Network section last, with its own entries, only when asked', () => {
        const { cms } = fixture();
        expect(settingsLinks(cms).some(link => link.id === 'network')).toBe(false);
        expect(settingsSearchEntries(cms).some(entry => entry.groupId === 'network')).toBe(false);
        const links = settingsLinks(cms, { network: true });
        const entries = settingsSearchEntries(cms, { network: true });
        expect(links.at(-1)).toMatchObject({ id: 'network', label: 'Network', href: `/dashboard/settings#${settingsSectionId('network')}` });
        expect(searchSettings(entries, 'multisite').map(entry => entry.id)).toEqual(['network.enabled']);
        expect(filterSettingsLinks(links, entries, 'new sites').map(({ id, count }) => ({ id, count }))).toEqual([{ id: 'network', count: 4 }]);
    });

    it('restores the complete menu when search clears and returns no unrelated groups for no matches', () => {
        const { cms } = fixture();
        const entries = settingsSearchEntries(cms);
        const links = settingsLinks(cms);
        const visible = filterSettingsLinks(links, entries, '');
        expect(visible.map(link => link.id)).toEqual(links.map(link => link.id));
        expect(visible.find(link => link.id === 'languages')?.count).toBe(2);
        expect(visible.find(link => link.id === 'plugins')?.count).toBe(2);
        expect(filterSettingsLinks(links, entries, 'no match anywhere')).toEqual([]);
        expect(links.every(link => link.count === undefined)).toBe(true);
    });
});
