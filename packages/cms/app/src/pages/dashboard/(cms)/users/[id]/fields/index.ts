import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { fieldVisibility, hasPermission, isCmsError, mediaUrl, PERMISSIONS } from '@cossackframework/cms';
import { findMedia, groupsView, metaInput, metaValues, type GroupsView } from '../../../../../../cms/content';
import { fieldControl, type MediaHooks, type MediaPreview } from '../../../../../../cms/field-controls';
import { FieldGroupView, plainBlocks, visibilityTypes, type RowPath } from '../../../../../../cms/field-group-view';
import { requireAny } from '../../../../../../cms/guards';
import { closedChooser, mediaChooser, uploadMedia, withFile, type MediaChooserState } from '../../../../../../cms/media-chooser';
import { box, notice, pageHeader } from '../../../../../../cms/ui';
import type { EditorField, EditorValues } from '../../../../../../cms/editor';
import { canManageUser } from '../../../../../../services/rbac';
import { getUser } from '../../../../../../services/users';
import type { PublicUser } from '../../../../../../auth';

/** Where a chosen file goes: a meta field, through the rows it sits in. */
interface MetaTarget { field: string; rows: RowPath; key: string; multiple: boolean }

/** A user's values for the field groups attached to users, one box per group. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageUsers)] })
export default class UserFields extends Cossack {
    @State() name = '';
    @State() fieldGroups: GroupsView = { groups: [], fields: [], options: [] };
    @State() meta: EditorValues = {};
    @State() previews: Record<string, MediaPreview> = {};
    @State() errors: Record<string, string> = {};
    @State() error = '';
    @State() found = false;
    @State() chooser: MediaChooserState = closedChooser();
    private target: MetaTarget | null = null;

    head(): HeadValue {
        return { title: `${__('Fields')} · ${this.name || __('User')}` };
    }

    async init() {
        const id = await this.editable().catch(() => null);
        if (!id) { this.error = __('This user does not exist.'); this.c.status(404); return; }
        const cms = this.c.get('cms');
        const user = await cms.users.get(id);
        if (!user) { this.error = __('This user does not exist.'); this.c.status(404); return; }
        this.name = user.name || user.email;
        this.fieldGroups = await groupsView(cms, { kind: 'users' });
        this.meta = metaValues(this.fieldGroups.fields, user.meta ?? {});
        this.previews = await this.metaPreviews(user.meta ?? {});
        this.found = true;
    }

    /** The user's ID when the signed-in user may change the account. */
    private async editable(): Promise<string> {
        const id = this.c.req.param('id') ?? '';
        const target = await getUser(id);
        if (!target || !canManageUser(this.user as PublicUser | undefined, target)) throw new Error(__('This user does not exist.'));
        return id;
    }

    /** Previews of the files the meta names, at any depth. */
    private async metaPreviews(meta: { readonly [field: string]: unknown }): Promise<Record<string, MediaPreview>> {
        const cms = this.c.get('cms');
        const ids: string[] = [];
        const walk = (value: unknown) => {
            if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)) ids.push(value);
            else if (Array.isArray(value)) value.forEach(walk);
            else if (value && typeof value === 'object') Object.values(value).forEach(walk);
        };
        walk(meta);
        if (!cms.files || !ids.length) return {};
        const files = await cms.files.getMany([...new Set(ids)].slice(0, 200));
        return Object.fromEntries([...files.values()].map(file => [file.id, { id: file.id, url: mediaUrl(file), title: file.title, alt: file.alt, contentType: file.contentType, width: file.width, height: file.height }]));
    }

    @Client()
    setMeta(name: string, value: unknown) {
        this.meta = { ...this.meta, [name]: value };
        if (this.errors[name]) this.errors = Object.fromEntries(Object.entries(this.errors).filter(([key]) => key !== name));
    }

    /** Set a row's field through the rows above it. */
    @Client()
    setRowValue(field: string, rows: RowPath, key: string, value: unknown) {
        const update = (list: unknown, depth: number): unknown => {
            const entries = Array.isArray(list) ? list as Record<string, unknown>[] : [];
            const row = rows[depth]!;
            return entries.map(entry => entry._id !== row.id ? entry : depth === rows.length - 1 ? { ...entry, [key]: value } : { ...entry, [rows[depth + 1]!.field]: update(entry[rows[depth + 1]!.field], depth + 1) });
        };
        this.setMeta(field, update(this.meta[field], 0));
    }

    private rowValue(field: string, rows: RowPath, key: string): unknown {
        let current: unknown = this.meta[field];
        for (const [index, row] of rows.entries()) {
            const found = (Array.isArray(current) ? current as Record<string, unknown>[] : []).find(entry => entry._id === row.id);
            if (!found) return undefined;
            current = index === rows.length - 1 ? found[key] : found[rows[index + 1]!.field];
        }
        return current;
    }

    // --- Media --------------------------------------------------------------------

    @Server()
    async searchMedia(search: string) {
        if (!hasPermission(this.c.get('principal'), PERMISSIONS.manageUsers)) return;
        this.chooser = { ...this.chooser, search, items: await findMedia(this.c.get('cms'), search) };
    }

    @Client()
    async openChooser(target: MetaTarget) {
        this.target = target;
        this.chooser = { ...this.chooser, open: true, field: target.key, multiple: target.multiple };
        await this.searchMedia(this.chooser.search);
    }

    @Client()
    chooseFile(file: MediaPreview) {
        const target = this.target;
        if (!target) return;
        this.previews = { ...this.previews, [file.id]: file };
        const current = target.rows.length ? this.rowValue(target.field, target.rows, target.key) : this.meta[target.field];
        const next = withFile(current, file.id, target.multiple);
        if (target.rows.length) this.setRowValue(target.field, target.rows, target.key, next); else this.setMeta(target.field, next);
        if (!target.multiple) this.chooser = { ...this.chooser, open: false };
    }

    @Client()
    async uploadFile(event: Event) {
        const { files, error } = await uploadMedia(event.currentTarget as HTMLInputElement);
        if (error) toast.error(error);
        for (const file of files) this.chooseFile(file);
        await this.searchMedia('');
    }

    // --- Saving -------------------------------------------------------------------

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.meta);
        if (this.error) toast.error(this.error); else toast.success(__('Saved.'));
    }

    @Server()
    async save(meta: EditorValues) {
        this.errors = {};
        this.error = '';
        const converted = metaInput(this.fieldGroups.fields, meta);
        if (Object.keys(converted.errors).length) { this.errors = converted.errors; this.error = __('Some fields are invalid.'); return; }
        try {
            const id = await this.editable();
            const cms = this.c.get('cms');
            await cms.users.update(id, { meta: converted.meta });
            this.meta = metaValues(this.fieldGroups.fields, (await cms.users.get(id))?.meta ?? {});
        } catch (error) {
            this.errors = isCmsError(error) && error.fields ? { ...error.fields } : {};
            this.error = isCmsError(error) || error instanceof Error ? error.message : __('The fields could not be saved.');
        }
    }

    // --- Rendering ----------------------------------------------------------------

    private metaControl(field: EditorField, value: unknown, change: (value: unknown) => void, rows: RowPath, id: string): TemplateResult | null {
        const root = rows[0]?.field ?? field.name;
        const media: MediaHooks = { previews: this.previews, choose: multiple => this.openChooser({ field: root, rows, key: field.name, multiple }) };
        return fieldControl(field, value, change, id, { media });
    }

    private groupBoxes(): TemplateResult {
        const { groups, fields, options } = this.fieldGroups;
        if (!groups.length) return notice(__('No field groups are attached to users. Attach one under Field groups.'));
        const hidden = fieldVisibility(plainBlocks(groups.flatMap(group => group.blocks)), visibilityTypes(options), this.meta).hidden;
        return html`${groups.map(group => box(group.title, html`
            ${group.description ? html`<p class="text-xs text-muted-foreground">${group.description}</p>` : null}
            ${component(FieldGroupView, {
                id: `group-${group.id}`, blocks: group.blocks, options, fields, values: this.meta, hidden, errors: this.errors,
                onChange: (name: string, value: unknown) => this.setMeta(name, value),
                control: (field: EditorField, value: unknown, change: (value: unknown) => void, rows: RowPath, id: string) => this.metaControl(field, value, change, rows, id),
            })}`, { id: `group-${group.id}-title` }))}`;
    }

    render() {
        if (!this.found) return notice(this.error || __('This user does not exist.'), 'error');
        const id = this.c.req.param('id') ?? '';
        return html`<div class="max-w-2xl space-y-6">
            ${pageHeader(`${__('Fields')}: ${this.name}`, { actions: html`<a href=${`/dashboard/users/${encodeURIComponent(id)}`} class="text-sm text-muted-foreground hover:text-foreground">← ${this.name}</a>` })}
            ${this.error ? notice(this.error, 'error') : null}
            <form class="space-y-6" @submit=${(event: Event) => this.submit(event)}>
                ${this.groupBoxes()}
                ${this.fieldGroups.groups.length ? html`<div>${component(Button, { type: 'submit' }, __('Save fields'))}</div>` : null}
            </form>
            ${mediaChooser(this.chooser, { search: text => this.searchMedia(text), choose: file => this.chooseFile(file), upload: event => this.uploadFile(event), close: () => { this.chooser = { ...this.chooser, open: false }; } })}
        </div>`;
    }
}
