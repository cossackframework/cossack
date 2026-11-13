/** Plugin settings are scalar declarations; the host supplies their namespace and access. */
import { fieldProblems, type FieldDeclaration } from './fields';
import { OWNER_NAME } from './resource';
import type { SettingDeclaration, SettingsSection } from './settings';
import { settingControlProblems } from './settings-controls';

/** Uses the shared field builders; manifest validation limits kinds and defaults to scalars. */
export type PluginSettingDeclaration = Pick<SettingDeclaration, 'kind' | 'default' | 'label' | 'description' | 'required' | 'nullable' | 'min' | 'max' | 'pattern' | 'values' | 'choices' | 'section' | 'control' | 'fileKinds'>;

export interface PluginSettingsDeclaration {
    readonly label: string;
    readonly description?: string;
    readonly sections?: readonly SettingsSection[];
    readonly fields: { readonly [name: string]: PluginSettingDeclaration };
}

export const PLUGIN_SETTINGS_LIMITS = Object.freeze({ fields: 128, sections: 32, label: 120, description: 2000 });
const KINDS = new Set(['string', 'text', 'enum', 'boolean', 'integer', 'number']);
const OPTIONS = new Set(['kind', 'label', 'description', 'required', 'nullable', 'default', 'min', 'max', 'pattern', 'values', 'choices', 'section', 'control', 'fileKinds']);
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const SECTION_ID = /^[a-z][a-z0-9-]{0,40}$/;

/** The plugin's storage namespace. A colon keeps it distinct from every ordinary group. */
export function pluginSettingsGroupId(name: string): string {
    if (typeof name !== 'string' || !OWNER_NAME.test(name) || name.length > 64) throw new TypeError('Invalid plugin settings owner.');
    return `plugin:${name}`;
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Check untrusted manifest data before the host adds any of its settings. */
export function pluginSettingsProblems(value: unknown): string[] {
    if (!object(value)) return ['settings must be an object.'];
    const problems: string[] = [];
    const label = (given: unknown, at: string, required = false) => {
        if (given === undefined && !required) return;
        if (typeof given !== 'string' || !given.trim() || given.length > PLUGIN_SETTINGS_LIMITS.label) problems.push(`${at} must be text of 1-${PLUGIN_SETTINGS_LIMITS.label} characters.`);
    };
    const description = (given: unknown, at: string) => {
        if (given !== undefined && (typeof given !== 'string' || given.length > PLUGIN_SETTINGS_LIMITS.description)) problems.push(`${at} must be text of at most ${PLUGIN_SETTINGS_LIMITS.description} characters.`);
    };
    for (const key of Object.keys(value)) if (!['label', 'description', 'sections', 'fields'].includes(key)) problems.push(`settings.${key} is not a settings declaration option.`);
    label(value.label, 'settings.label', true);
    description(value.description, 'settings.description');
    const sections = new Set<string>();
    if (value.sections !== undefined && (!Array.isArray(value.sections) || value.sections.length > PLUGIN_SETTINGS_LIMITS.sections)) {
        problems.push(`settings.sections must list at most ${PLUGIN_SETTINGS_LIMITS.sections} sections.`);
    } else for (const [index, section] of ((value.sections ?? []) as unknown[]).entries()) {
        const at = `settings.sections[${index}]`;
        if (!object(section)) { problems.push(`${at} must be a section object.`); continue; }
        for (const key of Object.keys(section)) if (!['id', 'label', 'description'].includes(key)) problems.push(`${at}.${key} is not a section option.`);
        if (typeof section.id !== 'string' || !SECTION_ID.test(section.id) || UNSAFE.has(section.id)) problems.push(`${at}.id must be a lowercase section name.`);
        else if (sections.has(section.id)) problems.push(`${at}.id is declared twice.`);
        else sections.add(section.id);
        label(section.label, `${at}.label`, true);
        description(section.description, `${at}.description`);
    }
    if (!object(value.fields)) return [...problems, 'settings.fields must be an object of field declarations.'];
    const fields = Object.entries(value.fields);
    if (!fields.length || fields.length > PLUGIN_SETTINGS_LIMITS.fields) problems.push(`settings.fields must declare 1-${PLUGIN_SETTINGS_LIMITS.fields} fields.`);
    for (const [name, declaration] of fields) {
        const at = `settings.fields.${name}`;
        if (UNSAFE.has(name)) { problems.push(`${at} is not a safe field name.`); continue; }
        if (!object(declaration) || typeof declaration.kind !== 'string' || !KINDS.has(declaration.kind)) {
            problems.push(`${at} must be a string, text, enum, boolean, integer or number field.`);
            continue;
        }
        let validShape = true;
        for (const key of Object.keys(declaration)) if (!OPTIONS.has(key)) { problems.push(`${at}.${key} is not a plugin setting option.`); validShape = false; }
        label(declaration.label, `${at}.label`);
        description(declaration.description, `${at}.description`);
        for (const key of ['required', 'nullable']) if (declaration[key] !== undefined && typeof declaration[key] !== 'boolean') { problems.push(`${at}.${key} must be true or false.`); validShape = false; }
        if (declaration.section !== undefined && (typeof declaration.section !== 'string' || !sections.has(declaration.section))) problems.push(`${at}.section must name a declared section.`);
        if (declaration.pattern !== undefined && typeof declaration.pattern !== 'string') { problems.push(`${at}.pattern must be a regular expression string.`); validShape = false; }
        for (const key of ['min', 'max']) {
            const bound = declaration[key];
            if (bound === undefined) continue;
            if (!['string', 'text', 'integer', 'number'].includes(declaration.kind) || typeof bound !== 'number' || !Number.isFinite(bound)) {
                problems.push(`${at}.${key} applies to text or numeric fields and must be a finite number.`);
                validShape = false;
            } else if (['string', 'text'].includes(declaration.kind) && (!Number.isSafeInteger(bound) || bound < 0)) {
                problems.push(`${at}.${key} must be a nonnegative whole character count.`);
                validShape = false;
            }
        }
        if (typeof declaration.min === 'number' && typeof declaration.max === 'number' && declaration.min > declaration.max) problems.push(`${at}.min must not exceed max.`);
        if (declaration.kind === 'enum') {
            if (!Array.isArray(declaration.values) || declaration.values.some(entry => typeof entry !== 'string')) { problems.push(`${at}.values must list enum strings.`); validShape = false; }
        } else if (declaration.values !== undefined) { problems.push(`${at}.values applies to enum fields only.`); validShape = false; }
        if (declaration.choices !== undefined) {
            if (declaration.kind !== 'enum' || !object(declaration.choices)) problems.push(`${at}.choices applies to enum fields and must map values to labels.`);
            else for (const [choice, text] of Object.entries(declaration.choices)) {
                if (UNSAFE.has(choice) || !Array.isArray(declaration.values) || !declaration.values.includes(choice)) problems.push(`${at}.choices.${choice} must name an enum value.`);
                label(text, `${at}.choices.${choice}`, true);
            }
        }
        if (declaration.default !== undefined && declaration.default !== null && !['string', 'number', 'boolean'].includes(typeof declaration.default)) {
            problems.push(`${at}.default must be a scalar value or null.`);
            validShape = false;
        }
        if (validShape) {
            // A malformed rule can also throw while the shared checker validates its default.
            try {
                problems.push(...fieldProblems(name, declaration as unknown as FieldDeclaration).map(problem => `settings: ${problem}`));
                problems.push(...settingControlProblems(name, declaration as unknown as SettingDeclaration).map(problem => `settings: ${problem}`));
            }
            catch { problems.push(`${at} has invalid validation rules or defaults.`); }
        }
    }
    return problems;
}
