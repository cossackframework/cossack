import { describe, expect, it, vi } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { field, manifestProblems, pluginSettingsGroupId, pluginSettingsProblems, type PluginSettingsDeclaration } from '../src/index';
import { createCMS, type PluginContext } from '../src/server/index';

const settings: PluginSettingsDeclaration = {
    label: 'Newsletter', description: 'Delivery options.',
    sections: [{ id: 'delivery', label: 'Delivery', description: 'Who receives updates.' }],
    fields: {
        enabled: { kind: 'boolean', default: false, section: 'delivery' },
        senderName: { kind: 'string', max: 120, default: '', section: 'delivery' },
        mode: { kind: 'enum', values: ['daily', 'weekly'], choices: { daily: 'Daily', weekly: 'Weekly' }, default: 'weekly' },
        retries: { kind: 'integer', min: 0, max: 10, default: 3 },
        ratio: { kind: 'number', nullable: true, default: null },
        footer: { kind: 'text', max: 1000 },
    },
};
const manifest = (name = 'newsletter', declaration: unknown = settings) => ({ schemaVersion: 1, name, version: '1.0.0', settings: declaration });
const database = () => ({ read: vi.fn(async () => ({ results: [{ rows: [] }] })) }) as unknown as RomeDB;

describe('plugin setting declarations', () => {
    it('accepts scalar settings and display sections as manifest data', () => {
        expect(pluginSettingsProblems(settings)).toEqual([]);
        const fromBuilders: PluginSettingsDeclaration = { label: 'Built with fields', fields: { title: field.string({ default: '' }), enabled: field.boolean({ default: true }) } };
        expect(pluginSettingsProblems(fromBuilders)).toEqual([]);
        expect(manifestProblems(manifest())).toEqual([]);
        expect(pluginSettingsGroupId('newsletter')).toBe('plugin:newsletter');
        expect(pluginSettingsGroupId('a'.repeat(64))).toBe(`plugin:${'a'.repeat(64)}`);
        expect(() => pluginSettingsGroupId('a'.repeat(65))).toThrow(/owner/);
        expect(() => pluginSettingsGroupId('other.name')).toThrow(/owner/);
    });

    it('rejects host metadata, unsupported kinds and resource-specific options', () => {
        expect(pluginSettingsProblems({ ...settings, id: 'general', permission: '*', json: true, plugin: 'other' })).toHaveLength(4);
        for (const declaration of [
            { kind: 'json' }, { kind: 'datetime' }, { kind: 'string', multiple: true },
            { kind: 'string', access: { read: '*' } }, { kind: 'string', index: true },
            { kind: 'string', source: 'roles' }, { kind: 'string', fields: {} },
            { kind: 'string', validate: () => true }, { kind: 'string', default: ['x'] },
        ]) expect(pluginSettingsProblems({ label: 'Test', fields: { value: declaration } }).length).toBeGreaterThan(0);
    });

    it('accepts fractional and negative numeric bounds as shared scalar fields do', () => {
        expect(pluginSettingsProblems({ label: 'Numbers', fields: {
            ratio: field.number({ min: 0, max: 0.5, default: 0.25 }),
            offset: field.number({ max: -0.25, default: -0.5 }),
            zero: field.integer({ max: 0, default: 0 }),
            negative: field.integer({ max: -2, default: -3 }),
        } })).toEqual([]);
    });

    it('checks section references, field names, choices, bounds and defaults', () => {
        expect(pluginSettingsProblems({ ...settings, sections: [{ id: 'delivery', label: 'A' }, { id: 'delivery', label: 'B' }] })).toContain('settings.sections[1].id is declared twice.');
        expect(pluginSettingsProblems({ label: 'Test', fields: { value: { kind: 'string', section: 'missing' } } })).toContain('settings.fields.value.section must name a declared section.');
        for (const name of ['bad.name', '__proto__', 'constructor', 'prototype']) {
            expect(pluginSettingsProblems({ label: 'Test', fields: Object.fromEntries([[name, { kind: 'string' }]]) }).length).toBeGreaterThan(0);
        }
        for (const declaration of [
            { kind: 'boolean', default: 'true' }, { kind: 'number', default: Infinity },
            { kind: 'string', default: null }, { kind: 'string', required: true, default: '' },
            { kind: 'integer', min: 5, max: 3 }, { kind: 'string', pattern: '[' },
            { kind: 'enum', values: ['a'], default: 'b' },
            { kind: 'enum', values: ['a'], choices: { b: 'Not declared' } },
            { kind: 'boolean', min: 0 }, { kind: 'string', min: 0.5 },
        ]) expect(pluginSettingsProblems({ label: 'Test', fields: { value: declaration } }).length).toBeGreaterThan(0);
    });

    it('reports malformed manifest values without throwing', () => {
        for (const value of [null, [], 'bad', { label: false, fields: [] }, { label: 'Test', sections: {}, fields: {} }]) {
            expect(pluginSettingsProblems(value).length).toBeGreaterThan(0);
        }
        for (const declaration of [
            null, [], true, { kind: 'enum', values: 'bad' }, { kind: 'enum', values: [1] },
            { kind: 'string', required: 'yes' }, { kind: 'string', nullable: 1 },
            { kind: 'string', pattern: {} }, { kind: 'string', pattern: '[', default: '' }, { kind: 'string', choices: [] },
        ]) expect(pluginSettingsProblems({ label: 'Test', fields: { value: declaration } }).length).toBeGreaterThan(0);
    });
});

describe('plugin settings registration', () => {
    it('isolates names, keeps the host metadata and registers before server callbacks', () => {
        const contexts = new Map<string, PluginContext>();
        const names = ['general', 'other', 'a'.repeat(64)];
        const cms = createCMS({ db: database(), plugins: names.map(name => ({
            name, version: '1.0.0', manifest: manifest(name), module: { register(context: PluginContext) { contexts.set(name, context); } },
        })) });
        for (const name of names) {
            expect(contexts.has(name)).toBe(true);
            expect(cms.settings.group(`plugin:${name}`)).toMatchObject({ id: `plugin:${name}`, plugin: name, permission: 'cms:settings', json: true, sections: settings.sections, fields: settings.fields });
        }
        expect(cms.settings.group('general').fields.siteTitle).toBeDefined();
    });

    it('omits invalid plugin settings without running their registration code', () => {
        const register = vi.fn();
        const cms = createCMS({ db: database(), plugins: [{ name: 'broken', version: '1.0.0', manifest: manifest('broken', { ...settings, fields: { value: { kind: 'json' } } }), module: { register } }] });
        expect(register).not.toHaveBeenCalled();
        expect(cms.settings.groups.some(group => group.plugin === 'broken')).toBe(false);
    });

    it('reserves plugin ownership and plugin namespaces for host registration', () => {
        for (const group of [
            { id: 'plugin:other', label: 'Other', fields: {} },
            { id: 'other', label: 'Other', fields: {}, plugin: 'other' },
        ]) expect(() => createCMS({ db: database(), settings: [group] })).toThrow(/assigned by the CMS host/);
    });

    it('marks theme options that occupy a reserved route invalid without breaking the host', () => {
        for (const name of ['plugins', 'json', 'constructor', 'prototype']) {
            const cms = createCMS({ db: database(), plugins: [{ name, version: '1.0.0',
                manifest: { schemaVersion: 1, name, version: '1.0.0', theme: { label: 'Reserved', options: { accent: { kind: 'string', default: 'blue' } } } },
                ui: { theme: { layout: () => null, entry: () => null, archive: () => null } },
            }] });
            expect(cms.themes()[0]!.problems).toContain(`Its options need a settings group named ${name}, which is taken, reserved or too long.`);
            expect(cms.settings.groups.some(group => group.id === name)).toBe(false);
        }
    });

    it('reports unsafe theme option names without breaking the host', () => {
        for (const name of ['__proto__', 'constructor', 'prototype']) {
            const cms = createCMS({ db: database(), plugins: [{ name: 'paper', version: '1.0.0',
                manifest: { schemaVersion: 1, name: 'paper', version: '1.0.0', theme: { label: 'Paper', options: Object.fromEntries([[name, { kind: 'string', default: 'blue' }]]) } },
                ui: { theme: { layout: () => null, entry: () => null, archive: () => null } },
            }] });
            expect(cms.themes()[0]!.problems).toContain(`theme.options.${name} is not a safe option name.`);
            expect(cms.settings.groups.some(group => group.id === 'paper')).toBe(false);
        }
    });

    it('guards plugin reads, restricts them to own fields and detaches snapshots', async () => {
        let context!: PluginContext;
        const cms = createCMS({ db: database(), plugins: [{ name: 'newsletter', version: '1.0.0', manifest: manifest(), module: { register(value: PluginContext) { context = value; } } }] });
        const active = vi.spyOn(cms, 'pluginActive').mockResolvedValue(false);
        await expect(context.settings.get('enabled')).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await expect(context.settings.all()).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        active.mockResolvedValue(true);
        expect(await context.settings.get('enabled')).toBe(false);
        for (const name of ['general.siteTitle', 'plugin:other.enabled', 'constructor', '__proto__']) {
            await expect(context.settings.get(name)).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        }
        const values = await context.settings.all();
        expect(values).toMatchObject({ enabled: false, senderName: '', mode: 'weekly', retries: 3, ratio: null });
        expect(Object.keys(values).sort()).toEqual(Object.keys(settings.fields).sort());
        (values as Record<string, unknown>).enabled = true;
        expect(await context.settings.get('enabled')).toBe(false);
        expect(context.settings).not.toHaveProperty('update');
    });
});
