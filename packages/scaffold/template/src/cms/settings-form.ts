/**
 * Forms for settings groups: Settings screens and Appearance → Customize render a group's
 * fields with these. Rows and values are plain data; the server converts them back.
 */
import { Checkbox, Field, Input, NativeSelect, Textarea } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { recordTitle, type Principal, type SettingDeclaration, type SettingsGroup } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';

export interface SettingRow { name: string; label: string; description: string; kind: string; min: number | null; max: number | null; choices: { value: string; label: string }[]; required: boolean }
export type SettingValues = Record<string, string | boolean>;

/** The group's rows, with choices filled in, and the current values as control values. */
export async function settingRows(cms: CmsHost, group: SettingsGroup, principal: Principal): Promise<{ rows: SettingRow[]; values: SettingValues }> {
    const stored = await cms.settings.all();
    const rows: SettingRow[] = [];
    const values: SettingValues = {};
    for (const [name, declaration] of Object.entries(group.fields)) {
        rows.push({ name, label: declaration.label ?? name, description: declaration.description ?? '', kind: declaration.kind, min: declaration.min ?? null, max: declaration.max ?? null,
            required: declaration.required === true, choices: await choices(cms, declaration, principal) });
        const value = stored[`${group.id}.${name}`];
        values[name] = typeof value === 'boolean' ? value : value === null || value === undefined ? '' : String(value);
    }
    return { rows, values };
}

async function choices(cms: CmsHost, declaration: SettingDeclaration, principal: Principal): Promise<SettingRow['choices']> {
    if (declaration.kind === 'enum') return (declaration.values ?? []).map(value => ({ value, label: declaration.choices?.[value] ?? value }));
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

/** Typed input from control values, or errors by field. */
export function settingInput(group: SettingsGroup, values: SettingValues): { input: Record<string, unknown>; errors: Record<string, string> } {
    const input: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const [name, declaration] of Object.entries(group.fields)) {
        if (!(name in values)) continue;
        const value = values[name];
        if (declaration.kind === 'boolean') input[name] = value === true;
        else if (declaration.kind === 'integer' || declaration.kind === 'number') {
            const number = Number(value);
            if (value === '' || !Number.isFinite(number)) errors[name] = __('must be a number.');
            else input[name] = number;
        } else input[name] = typeof value === 'string' ? (declaration.kind === 'text' ? value : value.trim()) : '';
    }
    return { input, errors };
}

/** One setting's control with its label, hint and error. */
export function settingControl(row: SettingRow, value: string | boolean | undefined, error: string | undefined, set: (value: string | boolean) => void): TemplateResult {
    const id = `setting-${row.name}`;
    if (row.kind === 'boolean') return html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
        ${component(Checkbox, { id, checked: value === true, '@change': (event: Event) => set((event.target as HTMLInputElement).checked) })} ${row.label}</label>`;
    const select = row.choices.length || row.kind === 'enum';
    return component(Field, { label: row.label, for: id, ...(row.description ? { hint: row.description } : {}), ...(error ? { error: `${row.label} ${error}` } : {}),
        control: attributes => select
            ? component(NativeSelect, { ...attributes, '@change': (event: Event) => set((event.target as HTMLSelectElement).value) }, html`
                ${row.kind === 'enum' ? null : html`<option value="" ?selected=${!value}>—</option>`}
                ${row.choices.map(choice => html`<option value=${choice.value} ?selected=${choice.value === value}>${choice.label}</option>`)}`)
            : row.kind === 'text' ? component(Textarea, { ...attributes, rows: 5, '.value': String(value ?? ''), '@input': (event: Event) => set((event.target as HTMLTextAreaElement).value) })
            : component(Input, { ...attributes, type: row.kind === 'integer' || row.kind === 'number' ? 'number' : 'text', ...(row.min !== null ? { min: row.min } : {}), ...(row.max !== null && row.kind !== 'string' && row.kind !== 'text' ? { max: row.max } : {}),
                '.value': String(value ?? ''), '@input': (event: Event) => set((event.target as HTMLInputElement).value) }) });
}
