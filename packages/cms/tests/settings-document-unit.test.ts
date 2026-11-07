import { describe, expect, it } from 'vitest';
import {
    checkSettingsDocument, field, isPortableSetting, parseSettingsDocument, settingsJsonSchema, stringifySettingsDocument,
    SETTINGS_DOCUMENT_MAX_BYTES, SETTINGS_DOCUMENT_MAX_FIELDS, type SettingsGroup,
} from '../src/index';

describe('settings JSON documents', () => {
    it('reads strict two-level scalar documents without changing their values', () => {
        const document = { general: { siteTitle: 'Text with { braces }, : commas and "quotes"', enabled: false, count: 0, ratio: 1.5, optional: null }, 'plugin:delivery': { sender: 'Café ☕' } };
        expect(parseSettingsDocument(JSON.stringify(document))).toEqual(document);
        expect(parseSettingsDocument('{}')).toEqual({});
        expect(parseSettingsDocument('{"general":{}}')).toEqual({ general: {} });
    });

    it('rejects duplicate namespace or field names, including Unicode-escaped aliases', () => {
        for (const text of [
            '{"general":{},"general":{}}',
            '{"general":{"title":"A","title":"B"}}',
            '{"general":{"title":"A","\\u0074itle":"B"}}',
            '{"general":{},"\\u0067eneral":{}}',
            '{"general":{"a\\\"b":1,"a\\u0022b":2}}',
        ]) expect(() => parseSettingsDocument(text)).toThrow(/Duplicate settings key/);
        expect(parseSettingsDocument('{"general":{"title":"same"},"plugin:other":{"title":"same"}}')).toEqual({ general: { title: 'same' }, 'plugin:other': { title: 'same' } });
    });

    it('rejects JSONC, malformed syntax, deeper objects, arrays and non-finite numbers', () => {
        for (const text of [
            '{/* comment */"general":{}}', '{"general":{},}', '{"general":{"x":1,}}', '{"general":{',
            '[]', 'null', 'true', '"text"', '{"general":[]}', '{"general":null}',
            '{"general":{"x":{}}}', '{"general":{"x":[]}}', '{"general":{"x":1e309}}',
        ]) expect(() => parseSettingsDocument(text)).toThrow();
    });

    it('rejects prototype-related names without polluting ordinary objects', () => {
        for (const name of ['__proto__', 'constructor', 'prototype']) {
            expect(() => parseSettingsDocument(`{"${name}":{}}`)).toThrow();
            expect(() => parseSettingsDocument(`{"general":{"${name}":"injected"}}`)).toThrow();
            expect(() => checkSettingsDocument(Object.fromEntries([[name, {}]]))).toThrow();
            expect(() => checkSettingsDocument({ general: Object.fromEntries([[name, false]]) })).toThrow();
        }
        expect(() => parseSettingsDocument('{"general":{"\\u005f_proto__":"injected"}}')).toThrow();
        expect(Object.getPrototypeOf({})).toBe(Object.prototype);
        expect(Object.prototype).not.toHaveProperty('injected');
    });

    it('rejects non-JSON RPC values and detaches accepted values', () => {
        for (const value of [undefined, () => 1, 1n, Infinity, NaN, new Date(), ['text'], { deep: true }]) {
            expect(() => checkSettingsDocument({ general: { value } })).toThrow();
        }
        expect(() => checkSettingsDocument(Object.create({ general: { title: 'inherited' } }))).toThrow();
        const input = { general: { title: 'Saved' } };
        const result = checkSettingsDocument(input);
        result.general!.title = 'Draft';
        expect(input.general.title).toBe('Saved');
        const nullPrototype = Object.assign(Object.create(null), { general: Object.assign(Object.create(null), { value: null }) });
        expect(checkSettingsDocument(nullPrototype)).toEqual({ general: { value: null } });
    });

    it('enforces UTF-8 byte and field limits before accepting an operation', () => {
        const payload = { general: { text: 'é'.repeat(SETTINGS_DOCUMENT_MAX_BYTES / 2) } };
        expect(JSON.stringify(payload).length).toBeLessThan(SETTINGS_DOCUMENT_MAX_BYTES);
        expect(() => parseSettingsDocument(JSON.stringify(payload))).toThrow(/48 KiB/);
        expect(() => checkSettingsDocument(payload)).toThrow(/48 KiB/);
        const fields = Object.fromEntries(Array.from({ length: SETTINGS_DOCUMENT_MAX_FIELDS + 1 }, (_, index) => [`f${index}`, false]));
        expect(() => checkSettingsDocument({ general: fields })).toThrow(/2048 fields/);
        expect(() => parseSettingsDocument(` ${' '.repeat(SETTINGS_DOCUMENT_MAX_BYTES)}{}`)).toThrow(/48 KiB/);
    });

    it('exports deterministic two-space JSON and a trailing newline', () => {
        const result = stringifySettingsDocument({ 'plugin:z': { b: false, a: null }, general: { title: 'Acme', count: 0 } });
        expect(result).toBe('{\n  "general": {\n    "count": 0,\n    "title": "Acme"\n  },\n  "plugin:z": {\n    "a": null,\n    "b": false\n  }\n}\n');
        expect(parseSettingsDocument(result)).toEqual({ general: { count: 0, title: 'Acme' }, 'plugin:z': { a: null, b: false } });
    });
});

describe('settings JSON schema', () => {
    it('uses patch semantics even when field values are required, and describes nullable values', () => {
        const groups: SettingsGroup[] = [{ id: 'plugin:delivery', label: 'Delivery', description: 'Delivery settings', json: true, plugin: 'delivery', fields: {
            title: field.string({ required: true, min: 2, max: 80, pattern: '[A-Za-z ]+', default: 'Sender', description: 'Visible sender' }),
            enabled: field.boolean({ nullable: true, default: false }),
            attempts: field.integer({ nullable: true, min: 0, max: 10 }),
            ratio: field.number({ min: 0, max: 5 }),
            mode: field.enum(['daily', 'weekly'], { nullable: true, default: null }),
            note: field.text({ nullable: true, max: 200 }),
        } }];
        const schema = settingsJsonSchema(groups) as { additionalProperties: boolean; required?: unknown; properties: Record<string, { required?: unknown; additionalProperties: boolean; properties: Record<string, unknown> }> };
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toBeUndefined();
        const group = schema.properties['plugin:delivery']!;
        expect(group.additionalProperties).toBe(false);
        expect(group.required).toBeUndefined();
        expect(group.properties.title).toMatchObject({ type: 'string', minLength: 2, maxLength: 80, pattern: '^(?:[A-Za-z ]+)$', default: 'Sender', description: 'Visible sender' });
        expect(group.properties.enabled).toMatchObject({ type: ['boolean', 'null'], default: false });
        expect(group.properties.attempts).toMatchObject({ type: ['integer', 'null'], minimum: 0, maximum: 10 });
        expect(group.properties.ratio).toMatchObject({ type: 'number', minimum: 0, maximum: 5 });
        expect(group.properties.mode).toMatchObject({ type: ['string', 'null'], enum: ['daily', 'weekly', null], default: null });
        expect(group.properties.note).toMatchObject({ type: ['string', 'null'], maxLength: 200 });
    });

    it('excludes structured fields and field-specific access from portable schemas', () => {
        const fields = { plain: field.string(), object: field.json(), list: field.string({ multiple: true }), private: field.string({ access: { read: 'secret' } }), nested: field.json({ fields: { x: field.string() } }) };
        expect(isPortableSetting(fields.plain)).toBe(true);
        for (const declaration of [fields.object, fields.list, fields.private, fields.nested]) expect(isPortableSetting(declaration)).toBe(false);
        const schema = settingsJsonSchema([{ id: 'custom', label: 'Custom', fields }]) as { properties: Record<string, { properties: Record<string, unknown> }> };
        expect(Object.keys(schema.properties.custom!.properties)).toEqual(['plain']);
    });
});
