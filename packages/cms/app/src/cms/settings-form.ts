/**
 * Forms for settings groups: Settings screens and Appearance → Customize render a group's
 * fields with these. Rows and values are plain data; the server converts them back.
 */
import { Checkbox, ColorPicker, Field, Input, NativeSelect, Textarea } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { CmsError, hasPermission, isCmsError, PERMISSIONS, recordTitle, type FieldMediaKind, type Principal, type SettingControl, type SettingDeclaration, type SettingsDocument, type SettingsGroup } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { findMedia } from './content';
import { SettingsFile, type SettingsMedia } from './settings-file';

export interface SettingRow { name: string; namespace: string; label: string; description: string; kind: string; min: number | null; max: number | null; choices: { value: string; label: string }[]; required: boolean; nullable: boolean; section: string; control?: SettingControl; fileKinds?: readonly FieldMediaKind[] }
export type SettingValue = string | boolean | null;
export type SettingValues = Record<string, SettingValue>;

/** Permit repairing an incompatible override without sending unrelated settings to the browser. */
export async function settingsEditorSnapshot(cms: CmsHost, principal: Principal): Promise<{ document: SettingsDocument; errors: Record<string, string> }> {
    try { return { document: await cms.settings.snapshot({ principal }), errors: {} }; }
    catch (error) {
        if (!isCmsError(error, 'CMS_VALIDATION') || !error.fields) throw error;
        cms.settings.refresh();
        const stored = await cms.settings.all();
        const document: SettingsDocument = {};
        for (const group of cms.settings.catalog({ principal })) for (const [name, declaration] of Object.entries(group.fields)) {
            const key = `${group.id}.${name}`;
            if (Object.hasOwn(error.fields, key)) continue;
            const value = stored[key];
            if (value === null && !declaration.nullable && declaration.default === undefined) continue;
            if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) (document[group.id] ??= {})[name] = value;
        }
        return { document, errors: { ...error.fields } };
    }
}

/** The choices read for each source (`roles`, `pages`, …), shared by every row of a page that lists them. */
export type ChoiceCache = Map<string, Promise<SettingRow['choices']>>;

/**
 * The group's rows, with choices filled in, and the current values as control values. Pass one
 * `cache` for every group of a page, so a source is read once however many fields list it.
 */
export async function settingRows(cms: CmsHost, group: SettingsGroup, principal: Principal, cache: ChoiceCache = new Map()): Promise<{ rows: SettingRow[]; values: SettingValues }> {
    const stored = await cms.settings.all();
    const rows: SettingRow[] = [];
    const values: SettingValues = {};
    for (const [name, declaration] of Object.entries(group.fields)) {
        rows.push({ name, namespace: group.id, label: declaration.label ?? name, description: declaration.description ?? '', kind: declaration.kind, min: declaration.min ?? null, max: declaration.max ?? null,
            required: declaration.required === true, nullable: declaration.nullable === true, section: declaration.section ?? '', choices: await choicesOf(cms, declaration, principal, cache),
            ...(declaration.control ? { control: declaration.control } : declaration.source === 'media' ? { control: 'file' as const } : {}),
            ...(declaration.fileKinds ? { fileKinds: [...declaration.fileKinds] } : declaration.source === 'media' ? { fileKinds: ['image'] } : {}) });
        const value = stored[`${group.id}.${name}`];
        values[name] = value === null && declaration.nullable ? null : typeof value === 'boolean' ? value : value === null || value === undefined ? '' : String(value);
    }
    return { rows, values };
}

function choicesOf(cms: CmsHost, declaration: SettingDeclaration, principal: Principal, cache: ChoiceCache): Promise<SettingRow['choices']> {
    if (declaration.control || declaration.source === 'media') return Promise.resolve([]);
    if (declaration.kind === 'enum') return Promise.resolve((declaration.values ?? []).map(value => ({ value, label: declaration.choices?.[value] ?? value })));
    if (!declaration.source) return Promise.resolve([]);
    let found = cache.get(declaration.source);
    if (!found) { found = sourceChoices(cms, declaration, principal); cache.set(declaration.source, found); }
    return found;
}

/** The choices a source offers: the site's roles, categories, published pages or the time zones. */
async function sourceChoices(cms: CmsHost, declaration: SettingDeclaration, principal: Principal): Promise<SettingRow['choices']> {
    switch (declaration.source) {
        case 'roles': return (await cms.users.roles()).filter(role => role.id !== 'admin').map(role => ({ value: role.id, label: role.name }));
        case 'categories': return (await cms.taxonomies.tree('categories')).map(term => ({ value: term.id, label: `${'— '.repeat(term.depth)}${term.name}` }));
        case 'pages': return (await cms.resource('cms/pages').list({ where: { status: 'published' }, order: { field: 'title', direction: 'asc' }, limit: 100 }, { principal }))
            .records.map(record => ({ value: record.id, label: recordTitle(record, 'title') }));
        case 'timezones': {
            const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
            return ['UTC', ...zones.filter(zone => zone !== 'UTC')].map(zone => ({ value: zone, label: zone.replaceAll('_', ' ') }));
        }
        default: return [];
    }
}

/** Match the media endpoint's authorization before a Settings or Customize server method lists files. */
export async function findSettingsMedia(cms: CmsHost, principal: Principal, search: string, kind: string) {
    if (![PERMISSIONS.upload, PERMISSIONS.manageMedia, PERMISSIONS.manageUsers].some(permission => hasPermission(principal, permission))) throw new CmsError('CMS_FORBIDDEN', __('Not allowed to see the media library.'));
    if (!cms.files) throw new CmsError('CMS_UNAVAILABLE', __('File storage is not configured.'));
    return findMedia(cms, typeof search === 'string' ? search : '', ['image', 'video', 'audio', 'archive', 'document'].includes(kind) ? kind : '');
}

/** Typed input from control values, or errors by field. */
export function settingInput(group: SettingsGroup, values: SettingValues): { input: Record<string, unknown>; errors: Record<string, string> } {
    const input: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    if (!values || typeof values !== 'object' || Array.isArray(values)) return { input, errors: { _form: __('Settings values must be an object.') } };
    for (const name of Object.keys(values)) if (!Object.hasOwn(group.fields, name)) errors[name] = __('is not a setting of this group.');
    for (const [name, declaration] of Object.entries(group.fields)) {
        if (!Object.hasOwn(values, name)) continue;
        const value = values[name];
        if (value !== null && typeof value !== 'string' && typeof value !== 'boolean') { errors[name] = __('has an invalid control value.'); continue; }
        if (value === null) input[name] = null;
        else if (declaration.kind === 'boolean') input[name] = value === true;
        else if (declaration.kind === 'integer' || declaration.kind === 'number') {
            const number = Number(value);
            if (value === '' || !Number.isFinite(number)) errors[name] = __('must be a number.');
            else input[name] = number;
        } else input[name] = typeof value === 'string' ? (declaration.kind === 'text' ? value : value.trim()) : '';
    }
    return { input, errors };
}

/** One setting's control with its label, hint and error. */
export function settingControlId(namespace: string, name: string): string { return `setting-${encodeURIComponent(namespace)}-${encodeURIComponent(name)}`; }

/** Native color inputs use opaque six-digit hex; keep the author's original text until they pick. */
export function settingPickerColor(value: string): string {
    if (/^#[0-9a-f]{3,4}$/i.test(value)) return `#${[...value.slice(1, 4)].map(digit => digit + digit).join('')}`;
    return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) ? value.slice(0, 7) : '#000000';
}

export function settingControl(row: SettingRow, value: SettingValue | undefined, error: string | undefined, set: (value: SettingValue) => void, media?: SettingsMedia): TemplateResult {
    const id = settingControlId(row.namespace, row.name);
    const select = row.choices.length || row.kind === 'enum';
    const control = component(Field, { label: row.label, for: id, ...(row.description ? { hint: row.description } : {}), ...(error ? { error: `${row.label} ${error}` } : {}),
        control: attributes => row.control === 'color'
            ? html`<div class="flex items-center gap-2">
                ${component(ColorPicker, { id: `${id}-picker`, label: `${__('Choose color')}: ${row.label}`, value: settingPickerColor(String(value ?? '')), disabled: value === null, onChange: set })}
                ${component(Input, { ...attributes, type: 'text', disabled: value === null, placeholder: '#000000', '.value': String(value ?? ''), '@input': (event: Event) => set((event.target as HTMLInputElement).value) })}
            </div>`
            : row.control === 'file'
            ? component(SettingsFile, { attributes, label: row.label, value: String(value ?? ''), disabled: value === null, kinds: row.fileKinds, media, onChange: set })
            : row.kind === 'boolean'
            ? component(Checkbox, { ...attributes, disabled: value === null, checked: value === true, '@change': (event: Event) => set((event.target as HTMLInputElement).checked) })
            : select
            ? component(NativeSelect, { ...attributes, disabled: value === null, '@change': (event: Event) => set((event.target as HTMLSelectElement).value) }, html`
                ${value === null ? html`<option value="" selected>${__('Null')}</option>` : null}
                ${row.kind === 'enum' ? null : html`<option value="" ?selected=${!value}>—</option>`}
                ${row.choices.map(choice => html`<option value=${choice.value} ?selected=${choice.value === value}>${choice.label}</option>`)}`)
            : row.kind === 'text' ? component(Textarea, { ...attributes, disabled: value === null, rows: 5, '.value': String(value ?? ''), '@input': (event: Event) => set((event.target as HTMLTextAreaElement).value) })
            : component(Input, { ...attributes, disabled: value === null, type: row.kind === 'integer' || row.kind === 'number' ? 'number' : 'text', ...(row.min !== null && row.kind !== 'string' && row.kind !== 'text' ? { min: row.min } : {}), ...(row.max !== null && row.kind !== 'string' && row.kind !== 'text' ? { max: row.max } : {}),
                ...(row.kind === 'integer' ? { step: 1 } : row.kind === 'number' ? { step: 'any' } : {}),
                '.value': String(value ?? ''), '@input': (event: Event) => set((event.target as HTMLInputElement).value) }) });
    return html`<div class="space-y-2">${control}${row.nullable ? component(Checkbox, { id: `${id}-null`, label: `${__('Set to null')}: ${row.label}`, checked: value === null,
        '@change': (event: Event) => set((event.target as HTMLInputElement).checked ? null : row.kind === 'boolean' ? false : row.kind === 'integer' || row.kind === 'number' ? '0' : row.kind === 'enum' ? row.choices[0]?.value ?? '' : '') }) : null}</div>`;
}
