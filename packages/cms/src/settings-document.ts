/** The portable, two-level settings format shared by dashboard forms and JSON editing. */
import { CmsError } from './errors';
import type { SettingDeclaration, SettingsGroup } from './settings';
import { settingControlPattern } from './settings-controls';

export type SettingsValue = string | number | boolean | null;
export type SettingsDocument = Record<string, Record<string, SettingsValue>>;
export const SETTINGS_DOCUMENT_MAX_BYTES = 48 * 1024;
export const SETTINGS_DOCUMENT_MAX_FIELDS = 2048;
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
const scalarKinds = new Set(['string', 'text', 'boolean', 'integer', 'number', 'enum']);
const encoder = new TextEncoder();

export function isPortableSetting(declaration: SettingDeclaration): boolean {
    return scalarKinds.has(declaration.kind) && !declaration.multiple && !declaration.fields && !declaration.access;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Check structure and limits, without using application declarations or permissions. Returns detached data. */
export function checkSettingsDocument(input: unknown): SettingsDocument {
    if (!record(input)) throw new CmsError('CMS_VALIDATION', 'Settings must be an object of namespaces and fields.');
    const document: SettingsDocument = {};
    let count = 0;
    for (const [namespace, fields] of Object.entries(input)) {
        if (unsafe.has(namespace) || !record(fields)) throw new CmsError('CMS_VALIDATION', 'Each settings namespace must contain an object of fields.', { fields: { [namespace]: 'must contain fields.' } });
        const values: Record<string, SettingsValue> = {};
        for (const [name, value] of Object.entries(fields)) {
            const key = `${namespace}.${name}`;
            if (unsafe.has(name) || !(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) {
                throw new CmsError('CMS_VALIDATION', 'Settings allow only scalar values at two levels.', { fields: { [key]: 'must be text, a finite number, a boolean, or an allowed null.' } });
            }
            if (++count > SETTINGS_DOCUMENT_MAX_FIELDS) throw new CmsError('CMS_LIMIT', `Settings documents contain at most ${SETTINGS_DOCUMENT_MAX_FIELDS} fields.`);
            values[name] = value;
        }
        document[namespace] = values;
    }
    if (encoder.encode(JSON.stringify(document)).byteLength > SETTINGS_DOCUMENT_MAX_BYTES) throw new CmsError('CMS_LIMIT', 'Settings documents must not exceed 48 KiB.');
    return document;
}

/** Strict JSON with duplicate-key detection, including keys written with Unicode escapes. */
export function parseSettingsDocument(text: string): SettingsDocument {
    if (typeof text !== 'string') throw new CmsError('CMS_VALIDATION', 'Settings JSON must be text.');
    if (encoder.encode(text).byteLength > SETTINGS_DOCUMENT_MAX_BYTES) throw new CmsError('CMS_LIMIT', 'Settings documents must not exceed 48 KiB.');
    let input: unknown;
    try { input = JSON.parse(text); }
    catch { throw new CmsError('CMS_VALIDATION', 'Enter valid JSON without comments or trailing commas.'); }
    // JSON.parse establishes syntax. This token pass retains keys that JSON.parse would overwrite.
    const stack: { keys: Set<string>; key: boolean }[] = [];
    for (const match of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}:,\[\]]/g)) {
        const token = match[0];
        if (token === '{') stack.push({ keys: new Set(), key: true });
        else if (token === '}') stack.pop();
        else if (token === ':' && stack.length) stack[stack.length - 1]!.key = false;
        else if (token === ',' && stack.length) stack[stack.length - 1]!.key = true;
        else if (token.startsWith('"') && stack.at(-1)?.key) {
            const key = JSON.parse(token) as string;
            const frame = stack.at(-1)!;
            if (frame.keys.has(key)) throw new CmsError('CMS_VALIDATION', `Duplicate settings key: ${key}.`);
            frame.keys.add(key);
        }
    }
    return checkSettingsDocument(input);
}

/** Stable export formatting. The resulting file obeys the same import limit. */
export function stringifySettingsDocument(input: SettingsDocument): string {
    const document = checkSettingsDocument(input);
    const sorted = Object.fromEntries(Object.keys(document).sort().map(namespace => [namespace,
        Object.fromEntries(Object.keys(document[namespace]!).sort().map(name => [name, document[namespace]![name]])),
    ]));
    const text = `${JSON.stringify(sorted, null, 2)}\n`;
    if (encoder.encode(text).byteLength > SETTINGS_DOCUMENT_MAX_BYTES) throw new CmsError('CMS_LIMIT', 'The formatted settings file exceeds 48 KiB and cannot be exported.');
    return text;
}

/** Schema for a patch document: missing fields preserve values, so no field is required here. */
export function settingsJsonSchema(groups: readonly SettingsGroup[]): object {
    const properties: Record<string, unknown> = {};
    for (const group of groups) {
        const fields: Record<string, unknown> = {};
        for (const [name, field] of Object.entries(group.fields)) {
            if (!isPortableSetting(field)) continue;
            const type = field.kind === 'integer' ? 'integer' : field.kind === 'number' ? 'number' : field.kind === 'boolean' ? 'boolean' : 'string';
            const schema: Record<string, unknown> = { type: field.nullable ? [type, 'null'] : type, title: field.label ?? name };
            if (field.description !== undefined) schema.description = field.description;
            if (field.default !== undefined) schema.default = field.default;
            if (field.kind === 'enum') schema.enum = field.nullable ? [...field.values!, null] : [...field.values!];
            if (field.kind === 'string' || field.kind === 'text') {
                if (field.min !== undefined || field.required) schema.minLength = Math.max(field.min ?? 0, field.required ? 1 : 0);
                if (field.max !== undefined) schema.maxLength = field.max;
                if (field.pattern !== undefined) schema.pattern = `^(?:${field.pattern})$`;
                if (field.control !== undefined) {
                    const pattern = settingControlPattern(field.control);
                    if (field.pattern !== undefined) schema.allOf = [{ pattern }];
                    else schema.pattern = pattern;
                }
            } else if (field.kind === 'number' || field.kind === 'integer') {
                if (field.min !== undefined) schema.minimum = field.min;
                if (field.max !== undefined) schema.maximum = field.max;
            }
            fields[name] = schema;
        }
        properties[group.id] = { type: 'object', title: group.label, ...(group.description ? { description: group.description } : {}), properties: fields, additionalProperties: false };
    }
    return { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties, additionalProperties: false };
}
