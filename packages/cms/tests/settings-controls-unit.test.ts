import { describe, expect, it, vi } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { pluginSettingsProblems, settingsJsonSchema, themeProblems, validateSettingValue, type SettingDeclaration, type SettingsGroup } from '../src/index';
import { CmsSettings } from '../src/server/site-settings';

const color: SettingDeclaration = { kind: 'string', control: 'color', default: '#2563eb' };
const file: SettingDeclaration = { kind: 'string', control: 'file', fileKinds: ['document'], nullable: true, default: null };
const declaration = (field: unknown) => ({ label: 'Brand', fields: { value: field } });
const group: SettingsGroup = { id: 'plugin:brand', plugin: 'brand', label: 'Brand', json: true, fields: { color, file } };
const context = { principal: { kind: 'system', reason: 'settings controls tests' } } as const;

describe('rich settings declarations', () => {
    it('accepts controls as scalar plugin and theme options', () => {
        expect(pluginSettingsProblems({ label: 'Brand', fields: { color, file } })).toEqual([]);
        expect(themeProblems({ label: 'Brand', options: { color, file } })).toEqual([]);
        for (const value of ['', '#fff', '#ABCD', '#123456', '#12345678', null]) {
            expect(pluginSettingsProblems(declaration({ ...color, nullable: true, default: value }))).toEqual([]);
        }
        for (const value of ['', '/media/file.pdf', 'https://cdn.example/file.pdf', 'http://localhost:3000/file', null]) {
            expect(pluginSettingsProblems(declaration({ ...file, default: value }))).toEqual([]);
        }
    });

    it('rejects incompatible control metadata and invalid defaults before registration', () => {
        for (const value of [
            { kind: 'string', control: 'unsupported' }, { kind: 'text', control: 'color' },
            { kind: 'boolean', control: 'file' }, { ...color, default: 'red' },
            { ...file, default: 'javascript:alert(1)' }, { ...file, default: ['file.pdf'] },
            { ...color, fileKinds: ['image'] }, { kind: 'string', fileKinds: ['image'] },
            { ...file, fileKinds: [] }, { ...file, fileKinds: 'image' }, { ...file, fileKinds: ['unknown'] },
            { ...file, fileKinds: ['image', 'image'] }, { ...file, fileKinds: [{}] },
        ]) expect(pluginSettingsProblems(declaration(value)).length).toBeGreaterThan(0);
        expect(themeProblems({ label: 'Brand', options: { color: { ...color, default: 'red' } } })).toEqual([expect.stringContaining('default must be a hex color')]);
    });

    it('also rejects incompatible controls in application settings groups', () => {
        const db = {} as RomeDB;
        for (const field of [
            { ...file, multiple: true }, { ...file, media: true }, { ...file, source: 'media' as const },
            { ...color, default: '#12345' },
        ]) expect(() => new CmsSettings(db, [{ ...group, fields: { value: field } }])).toThrow();
    });
});

describe('rich settings values', () => {
    it('accepts hex colors with optional alpha and preserves existing required/null rules', () => {
        for (const value of ['', '#123', '#abcd', '#ABCDEF', '#12345678']) expect(validateSettingValue('color', color, value)).toBeUndefined();
        for (const value of ['red', '#12', '#12345', '#1234567', '#123456789', '#zzzzzz', ' #fff', '#fff\n', 12, null, {}]) {
            expect(validateSettingValue('color', color, value)).toEqual(expect.any(String));
        }
        expect(validateSettingValue('color', { ...color, nullable: true }, null)).toBeUndefined();
        expect(validateSettingValue('color', { ...color, required: true }, '')).toBe('is required.');
        expect(validateSettingValue('color', { ...color, pattern: '#[0-9a-f]{6}' }, '#ABCDEF')).toBe('has an invalid format.');
    });

    it('accepts file URLs and rejects unsafe or malformed URL forms', () => {
        for (const value of ['', null, '/media/a%20b.pdf', '/media/image.svg?size=100#preview', 'https://cdn.example/file.pdf', 'http://localhost:3000/file']) {
            expect(validateSettingValue('file', file, value)).toBeUndefined();
        }
        for (const value of [
            'javascript:alert(1)', 'data:image/png;base64,AA', 'file:///tmp/a', 'media/document.pdf',
            '//example.com/file', '/\\example.com/file', 'https://example.com\\file', 'https://',
            'https://user:password@example.com/file', 'https://example.com/file\n', '/file\u0000.pdf', '/my file.pdf',
            'https://example.com:999999/file', ['https://example.com/file'], {}, true,
        ]) expect(validateSettingValue('file', file, value)).toEqual(expect.any(String));
        expect(validateSettingValue('file', { ...file, required: true }, '')).toBe('is required.');
        expect(validateSettingValue('file', { ...file, nullable: false }, null)).toBe('cannot be null.');
    });

    it('describes control syntax alongside author patterns in the JSON editor', () => {
        const schema = settingsJsonSchema([{ ...group, fields: { color: { ...color, pattern: '#[A-F0-9]+' }, file } }]) as { properties: Record<string, { properties: Record<string, { type: unknown; pattern: string; allOf?: { pattern: string }[] }> }> };
        const fields = schema.properties[group.id]!.properties;
        expect(fields.color!.type).toBe('string');
        expect(fields.color!.pattern).toBe('^(?:#[A-F0-9]+)$');
        expect(new RegExp(fields.color!.allOf![0]!.pattern).test('#ABC')).toBe(true);
        expect(new RegExp(fields.color!.allOf![0]!.pattern).test('#ABCDE')).toBe(false);
        expect(fields.file!.type).toEqual(['string', 'null']);
        expect(new RegExp(fields.file!.pattern).test('/media/file.pdf')).toBe(true);
        expect(new RegExp(fields.file!.pattern).test('javascript:alert(1)')).toBe(false);
    });

    it('rejects invalid values before either save path writes and reports invalid stored overrides', async () => {
        const read = vi.fn(async () => ({ sequence: 1, results: [{ rows: [['plugin:brand.color', '"red"'], ['plugin:brand.file', '"javascript:alert(1)"']] }] }));
        const write = vi.fn();
        const settings = new CmsSettings({ read, write } as unknown as RomeDB, [group]);
        await expect(settings.update(group.id, { color: 'red', file: '//example.com/file' }, context)).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { color: expect.any(String), file: expect.any(String) } });
        await expect(settings.applyDocument({ [group.id]: { color: '#12', file: 'data:text/plain,hello' } }, context)).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { 'plugin:brand.color': expect.any(String), 'plugin:brand.file': expect.any(String) } });
        expect(write).not.toHaveBeenCalled();
        expect(await settings.all()).toEqual({ 'plugin:brand.color': '#2563eb', 'plugin:brand.file': null });
        await expect(settings.snapshot(context)).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { 'plugin:brand.color': expect.any(String), 'plugin:brand.file': expect.any(String) } });
        await expect(settings.exportDocument(context)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(settings.applyDocument({ [group.id]: { color: '#fff' } }, context)).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { 'plugin:brand.file': expect.any(String) } });
        expect(write).not.toHaveBeenCalled();
    });
});
