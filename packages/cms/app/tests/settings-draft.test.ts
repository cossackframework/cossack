import { afterEach, describe, expect, it, vi } from 'vitest';
import { CmsError, field, systemPrincipal } from '../../src/index';
import type { CmsHost } from '../../src/server';
import { SettingsDraft, settingsChanges, settingsNavigation } from '../src/cms/settings-draft';
import { settingControlId, settingInput, settingsEditorSnapshot, type SettingRow } from '../src/cms/settings-form';

// Execute client draft logic in Node; production browser tests cover classification and hydration.
vi.mock('@cossackframework/core', async importOriginal => ({
    ...await importOriginal<typeof import('@cossackframework/core')>(),
    Client: () => (_target: unknown, _name: unknown, descriptor: PropertyDescriptor) => descriptor,
}));

const row = (name: string, kind: string): SettingRow => ({ name, namespace: 'plugin:newsletter', kind, label: name, description: '', min: null, max: null, choices: [], required: false, nullable: true, section: '' });

afterEach(() => vi.unstubAllGlobals());

describe('settings form drafts', () => {
    it('keeps null separate from empty strings, zero and false through form and JSON changes', () => {
        const draft = new SettingsDraft();
        draft.initialize({ 'plugin:newsletter': { text: null, count: null, enabled: null, choice: null } });
        draft.set(row('text', 'string'), '');
        draft.set(row('count', 'number'), '0');
        draft.set(row('enabled', 'boolean'), false);
        draft.set(row('choice', 'enum'), 'first');
        expect(draft.changes()).toEqual({ 'plugin:newsletter': { text: '', count: 0, enabled: false, choice: 'first' } });
        draft.editJson('{"plugin:newsletter":{"count":null,"text":null,"enabled":null,"choice":null}}');
        expect(draft.control(row('count', 'number'))).toBe(null);
        expect(draft.control(row('enabled', 'boolean'))).toBe(null);
        expect(draft.dirty()).toBe(false);
        expect(settingInput({ id: 'x', label: 'X', fields: { text: field.string({ nullable: true }), count: field.number({ nullable: true }), enabled: field.boolean({ nullable: true }) } },
            { text: null, count: null, enabled: null })).toEqual({ input: { text: null, count: null, enabled: null }, errors: {} });
    });

    it('keeps invalid JSON and refuses form edits until the JSON is fixed or discarded', () => {
        const draft = new SettingsDraft();
        draft.initialize({ general: { siteTitle: 'Original' }, 'plugin:newsletter': { enabled: false } });
        draft.editJson('{"general":');
        draft.set(row('enabled', 'boolean'), true);
        expect(draft.rawJson).toBe('{"general":');
        expect(draft.values['plugin:newsletter']!.enabled).toBe(false);
        expect(draft.jsonError).toBeTruthy();
        expect(draft.dirty()).toBe(true);
        draft.discard();
        expect(draft.jsonError).toBe('');
        expect(draft.dirty()).toBe(false);
    });

    it('sends only edited fields and preserves the loaded baseline when navigating between views', () => {
        const draft = new SettingsDraft();
        draft.initialize({ general: { siteTitle: 'Original', tagline: 'Unchanged' }, 'plugin:newsletter': { enabled: false } });
        draft.editJson('{"general":{"siteTitle":"Draft"}}');
        draft.initialize({ general: { siteTitle: 'Changed elsewhere', tagline: 'Changed elsewhere' } });
        expect(draft.changes()).toEqual({ general: { siteTitle: 'Draft' } });
        expect(draft.values.general!.tagline).toBe('Unchanged');
        expect(settingsChanges(draft.baseline, {})).toEqual({});
    });

    it('allows form editing when the complete catalog is larger than an import file', () => {
        const draft = new SettingsDraft();
        const document = { general: { text: 'x'.repeat(60 * 1024) }, 'plugin:newsletter': { enabled: false } };
        expect(() => draft.initialize(document)).not.toThrow();
        draft.set(row('enabled', 'boolean'), true);
        expect(draft.changes()).toEqual({ 'plugin:newsletter': { enabled: true } });
    });

    it('requires explicit corrections for incompatible saved values, including selecting a fallback default', () => {
        const draft = new SettingsDraft();
        draft.initialize({}, { 'plugin:newsletter.count': 'must be a number.' });
        expect(draft.dirty()).toBe(false);
        expect(draft.hasInvalidControls()).toBe(false);
        draft.set(row('count', 'number'), '0');
        expect(draft.changes()).toEqual({ 'plugin:newsletter': { count: 0 } });
        expect(draft.errors).toEqual({});
        draft.discard();
        expect(draft.errors).toHaveProperty('plugin:newsletter.count');
    });

    it('gives the same field name distinct control identities for different plugins', () => {
        expect(settingControlId('plugin:newsletter', 'enabled')).not.toBe(settingControlId('plugin:receipts', 'enabled'));
        expect(settingControlId('plugin:newsletter', 'enabled')).not.toMatch(/\s/);
    });

    it('retains specialized edits across search, section remounts and unrelated document saves', () => {
        const draft = new SettingsDraft();
        const languages = { main: 'en', others: ['fr'], custom: '', added: [] as string[] };
        const permalinks = { postsBase: 'posts', bases: [{ name: 'categories', path: 'category' }] };
        draft.initialize({ general: { siteTitle: 'Original' } });
        draft.initializeSection('languages', languages);
        draft.initializeSection('permalinks', permalinks);
        draft.setSection('languages', { ...languages, main: 'fr', others: ['en'] });
        draft.setSection('permalinks', { ...permalinks, postsBase: 'articles' });
        draft.setSearch('general.siteTitle');
        // Filtering can dispose the component. A later mount must not seed over its edits.
        draft.initializeSection('languages', languages);
        draft.initializeSection('permalinks', permalinks);
        draft.accept({ general: { siteTitle: 'Saved title' } });
        draft.setSearch('');
        expect(draft.section('languages', languages)).toEqual({ ...languages, main: 'fr', others: ['en'] });
        expect(draft.section('permalinks', permalinks).postsBase).toBe('articles');
        expect(draft.sectionDirty('languages')).toBe(true);
        expect(draft.sectionDirty('permalinks')).toBe(true);
        expect(draft.documentDirty()).toBe(false);
        expect(draft.dirty()).toBe(true);
        expect(draft.values).toEqual({ general: { siteTitle: 'Saved title' } });
        expect(draft.rawJson).not.toContain('languages');
        expect(draft.rawJson).not.toContain('permalinks');
    });

    it('protects unsaved specialized changes on exit and restores every baseline on global discard', () => {
        const confirm = vi.fn(() => false);
        vi.stubGlobal('__', (value: string) => value);
        vi.stubGlobal('window', { location: { pathname: '/dashboard/settings' }, confirm });
        const draft = new SettingsDraft();
        draft.navigated('/dashboard/settings');
        draft.initialize({ 'plugin:newsletter': { enabled: false } });
        draft.initializeSection('languages', { main: 'en', others: [] as string[] });
        draft.initializeSection('permalinks', { postsBase: 'posts' });
        draft.setSection('languages', { main: 'fr', others: ['en'] });
        expect(draft.documentDirty()).toBe(false);
        expect(draft.preventNavigation()).toBe(true);
        expect(confirm).toHaveBeenCalledTimes(1);
        draft.set(row('enabled', 'boolean'), true);
        draft.setSection('permalinks', { postsBase: 'articles' });
        expect(draft.discards).toBe(0);
        draft.discard();
        // The page clears what the last save reported when the toolbar discards.
        expect(draft.discards).toBe(1);
        expect(draft.values['plugin:newsletter']!.enabled).toBe(false);
        expect(draft.section('languages', null)).toEqual({ main: 'en', others: [] });
        expect(draft.section('permalinks', null)).toEqual({ postsBase: 'posts' });
        expect(draft.dirty()).toBe(false);
        expect(draft.preventNavigation()).toBe(false);
        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('accepts and discards sections independently without sharing mutable input arrays', () => {
        const draft = new SettingsDraft();
        draft.initialize({ 'plugin:newsletter': { enabled: false } });
        const languageInput = { main: 'en', others: ['fr'] };
        draft.initializeSection('languages', languageInput);
        languageInput.others.push('de');
        expect(draft.section('languages', languageInput).others).toEqual(['fr']);
        draft.initializeSection('permalinks', { postsBase: 'posts' });
        draft.set(row('enabled', 'boolean'), true);
        draft.setSection('languages', { main: 'fr', others: ['en'] });
        draft.setSection('permalinks', { postsBase: 'articles' });
        const savedLanguages = { main: 'fr', others: ['en'] };
        draft.acceptSection('languages', savedLanguages);
        savedLanguages.others.push('de');
        expect(draft.sectionDirty('languages')).toBe(false);
        expect(draft.sectionDirty('permalinks')).toBe(true);
        expect(draft.documentDirty()).toBe(true);
        draft.discardSection('permalinks');
        expect(draft.section('permalinks', null)).toEqual({ postsBase: 'posts' });
        expect(draft.section('languages', null)).toEqual({ main: 'fr', others: ['en'] });
        expect(draft.documentDirty()).toBe(true);
        draft.setSection('languages', { main: 'de', others: ['fr'] });
        draft.discardSection('languages');
        expect(draft.section('languages', null)).toEqual({ main: 'fr', others: ['en'] });
        expect(draft.sectionDirty('languages')).toBe(false);
    });

    it('omits unset nonnullable fields and unauthorized groups from repair snapshots', async () => {
        const refresh = vi.fn();
        const all = vi.fn().mockResolvedValue({ 'plugin:newsletter.count': 0, 'plugin:newsletter.optional': null, 'plugin:newsletter.nullable': null, 'appearance.theme': 'private' });
        const cms = { settings: {
            snapshot: vi.fn().mockRejectedValue(new CmsError('CMS_VALIDATION', 'Invalid saved value.', { fields: { 'plugin:newsletter.count': 'must be a number.' } })),
            refresh, all, catalog: () => [{ id: 'plugin:newsletter', fields: { count: field.number({ default: 0 }), optional: field.string(), nullable: field.string({ nullable: true }) } }],
        } } as unknown as CmsHost;
        const result = await settingsEditorSnapshot(cms, systemPrincipal('settings-test'));
        expect(result).toEqual({ document: { 'plugin:newsletter': { nullable: null } }, errors: { 'plugin:newsletter.count': 'must be a number.' } });
        expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(all.mock.invocationCallOrder[0]!);
    });

    it('consumes internal navigation allowances and expires canceled clicks before an external exit', async () => {
        const confirm = vi.fn(() => false);
        vi.stubGlobal('__', (value: string) => value);
        vi.stubGlobal('window', { location: { href: 'https://example.test/dashboard/settings/plugins', origin: 'https://example.test', pathname: '/dashboard/settings/plugins' }, confirm });
        const draft = new SettingsDraft();
        draft.initialize({ 'plugin:newsletter': { enabled: false } });
        draft.set(row('enabled', 'boolean'), true);
        draft.navigated('/dashboard/settings/plugins');
        const click = (extra: Record<string, unknown> = {}) => ({ button: 0, defaultPrevented: false,
            currentTarget: { href: 'https://example.test/dashboard/settings/json', target: '', hasAttribute: () => false }, ...extra }) as unknown as MouseEvent;
        settingsNavigation(click());
        expect(draft.preventNavigation()).toBe(false);
        expect(confirm).not.toHaveBeenCalled();
        expect(draft.preventNavigation()).toBe(true);
        expect(confirm).toHaveBeenCalledTimes(1);
        settingsNavigation(click());
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(draft.preventNavigation()).toBe(true);
        settingsNavigation(click({ ctrlKey: true }));
        expect(draft.preventNavigation()).toBe(true);
        expect(confirm).toHaveBeenCalledTimes(3);
    });
});
