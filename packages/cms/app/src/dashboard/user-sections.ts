/**
 * The field groups attached to users, as meta boxes on the user screen's Profile tab, with their
 * own Save and media chooser. The screen loads them with `userFields`; the boxes save through
 * `POST /api/cms/users/<id>/meta`. Replaces the scaffold's empty module.
 */
import type { Context } from 'hono';
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button } from '@cossackframework/ui';
import { fieldVisibility, hasPermission, PERMISSIONS } from '@cossackframework/cms';
import { groupsView, metaFilePreviews, metaValues, type GroupsView } from '../cms/content';
import type { EditorField, EditorValues } from '../cms/editor';
import { fieldControl, type MediaHooks, type MediaPreview } from '../cms/field-controls';
import { FieldGroupView, plainBlocks, visibilityTypes, type RowPath } from '../cms/field-group-view';
import { closedChooser, mediaChooser, uploadMedia, withFile, type MediaChooserState } from '../cms/media-chooser';
import { box, notice } from '../cms/ui';

export interface UserFieldsData {
    readonly view: GroupsView;
    readonly values: EditorValues;
    readonly previews: Record<string, MediaPreview>;
}

/** The user's field groups and values, for people who manage users; null when no group is attached. */
export async function userFields(c: Context, userId: string): Promise<UserFieldsData | null> {
    if (!hasPermission(c.get('principal'), PERMISSIONS.manageUsers)) return null;
    const cms = c.get('cms');
    const view = await groupsView(cms, { kind: 'users' });
    if (!view.groups.length) return null;
    const meta = (await cms.users.get(userId))?.meta ?? {};
    return { view, values: metaValues(view.fields, meta), previews: await metaFilePreviews(cms, meta) };
}

/** Where a chosen file goes: a meta field, through the rows it sits in. */
interface MetaTarget { field: string; rows: RowPath; key: string; multiple: boolean }

@Component()
export class UserFields extends Cossack {
    declare props: { userId: string; data: UserFieldsData };
    /** The values being edited; the loaded ones until the first change. */
    @ClientState() private values: EditorValues | null = null;
    @ClientState() private previews: Record<string, MediaPreview> = {};
    @ClientState() private errors: Record<string, string> = {};
    @ClientState() private message = '';
    @ClientState() private error = '';
    @ClientState() private saving = false;
    @ClientState() private chooser: MediaChooserState = closedChooser();
    private target: MetaTarget | null = null;

    private get current(): EditorValues {
        return this.values ?? this.props.data.values;
    }

    @Client()
    private set(name: string, value: unknown) {
        this.values = { ...this.current, [name]: value };
        if (this.errors[name]) this.errors = Object.fromEntries(Object.entries(this.errors).filter(([key]) => key !== name));
    }

    /** Set a row's field through the rows above it. */
    @Client()
    private setRowValue(field: string, rows: RowPath, key: string, value: unknown) {
        const update = (list: unknown, depth: number): unknown => (Array.isArray(list) ? list as Record<string, unknown>[] : []).map(entry => {
            const row = rows[depth]!;
            if (entry._id !== row.id) return entry;
            return depth === rows.length - 1 ? { ...entry, [key]: value } : { ...entry, [rows[depth + 1]!.field]: update(entry[rows[depth + 1]!.field], depth + 1) };
        });
        this.set(field, update(this.current[field], 0));
    }

    @Client()
    private rowValue(field: string, rows: RowPath, key: string): unknown {
        let value: unknown = this.current[field];
        for (const [index, row] of rows.entries()) {
            const found = (Array.isArray(value) ? value as Record<string, unknown>[] : []).find(entry => entry._id === row.id);
            if (!found) return undefined;
            value = index === rows.length - 1 ? found[key] : found[rows[index + 1]!.field];
        }
        return value;
    }

    // --- Media --------------------------------------------------------------------

    @Client()
    private async searchMedia(search: string) {
        const query = new URLSearchParams({ q: search, kind: this.chooser.kind });
        const response = await fetch(`/api/cms/media?${query}`).catch(() => null);
        const items = response?.ok ? (await response.json() as { items: MediaPreview[] }).items : [];
        this.chooser = { ...this.chooser, search, items };
    }

    @Client()
    private async filterMedia(kind: string) {
        this.chooser = { ...this.chooser, kind };
        await this.searchMedia(this.chooser.search);
    }

    @Client()
    private async openChooser(target: MetaTarget) {
        this.target = target;
        this.chooser = { ...this.chooser, open: true, error: '', field: target.key, multiple: target.multiple, kind: 'image' };
        await this.searchMedia(this.chooser.search);
    }

    @Client()
    private chooseFile(file: MediaPreview) {
        const target = this.target;
        if (!target) return;
        this.previews = { ...this.previews, [file.id]: file };
        const current = target.rows.length ? this.rowValue(target.field, target.rows, target.key) : this.current[target.field];
        const next = withFile(current, file.id, target.multiple);
        if (target.rows.length) this.setRowValue(target.field, target.rows, target.key, next); else this.set(target.field, next);
        if (!target.multiple) this.chooser = { ...this.chooser, open: false };
    }

    @Client()
    private async uploadFile(event: Event) {
        const { files, error } = await uploadMedia(event.currentTarget as HTMLInputElement);
        this.chooser = { ...this.chooser, error };
        for (const file of files) this.chooseFile(file);
        await this.searchMedia('');
    }

    // --- Saving -------------------------------------------------------------------

    @Client()
    private async save(event: Event) {
        event.preventDefault();
        this.saving = true;
        this.message = '';
        this.error = '';
        try {
            const response = await fetch(`/api/cms/users/${encodeURIComponent(this.props.userId)}/meta`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ meta: this.current }),
            });
            const result = await response.json().catch(() => ({})) as { values?: EditorValues; error?: string; fields?: Record<string, string> };
            if (!response.ok) { this.errors = result.fields ?? {}; this.error = result.error ?? __('The fields could not be saved.'); return; }
            this.errors = {};
            this.values = result.values ?? this.current;
            this.message = __('Fields saved.');
        } catch { this.error = __('The fields could not be saved.'); }
        finally { this.saving = false; }
    }

    // --- Rendering ----------------------------------------------------------------

    private control(field: EditorField, value: unknown, change: (value: unknown) => void, rows: RowPath, id: string): TemplateResult | null {
        const root = rows[0]?.field ?? field.name;
        const media: MediaHooks = { previews: { ...this.props.data.previews, ...this.previews }, choose: multiple => this.openChooser({ field: root, rows, key: field.name, multiple }) };
        return fieldControl(field, value, change, id, { media });
    }

    render() {
        const { groups, fields, options } = this.props.data.view;
        const values = this.current;
        const hidden = fieldVisibility(plainBlocks(groups.flatMap(group => group.blocks)), visibilityTypes(options), values).hidden;
        return html`<form class="space-y-4" data-user-fields @submit=${(event: Event) => this.save(event)}>
            ${this.message && !this.error ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${groups.map(group => box(group.title, html`
                ${group.description ? html`<p class="text-xs text-muted-foreground">${group.description}</p>` : null}
                ${component(FieldGroupView, {
                    id: `group-${group.id}`, blocks: group.blocks, options, fields, values, hidden, errors: this.errors,
                    onChange: (name: string, value: unknown) => this.set(name, value),
                    control: (field: EditorField, value: unknown, change: (value: unknown) => void, rows: RowPath, id: string) => this.control(field, value, change, rows, id),
                })}`, { id: `group-${group.id}-title` }))}
            <div>${component(Button, { type: 'submit', variant: 'outline', disabled: this.saving }, this.saving ? __('Saving…') : __('Save fields'))}</div>
            ${mediaChooser(this.chooser, { search: text => this.searchMedia(text), filter: kind => this.filterMedia(kind), choose: file => this.chooseFile(file),
                upload: event => this.uploadFile(event), close: () => { this.chooser = { ...this.chooser, open: false }; } })}
        </form>`;
    }
}
