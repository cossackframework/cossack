import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, Field, Input, NativeSelect, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { fieldVisibility, hasPermission, isCmsError, mediaUrl, PERMISSIONS, slugify } from '@cossackframework/cms';
import { findMedia, groupsView, metaInput, metaValues, type GroupsView } from '../../../../../../cms/content';
import { fieldControl, type MediaHooks, type MediaPreview } from '../../../../../../cms/field-controls';
import { FieldGroupView, plainBlocks, visibilityTypes, type RowPath } from '../../../../../../cms/field-group-view';
import { requireAny } from '../../../../../../cms/guards';
import { closedChooser, mediaChooser, uploadMedia, withFile, type MediaChooserState } from '../../../../../../cms/media-chooser';
import { iconSelect } from '../../../../../../cms/term-icons';
import { box, notice, pageHeader } from '../../../../../../cms/ui';
import type { EditorField, EditorValues } from '../../../../../../cms/editor';

interface Draft { name: string; slug: string; parent: string; description: string; icon: string }
/** Where a chosen file goes: a meta field, through the rows it sits in. */
interface MetaTarget { field: string; rows: RowPath; key: string; multiple: boolean }

/** Edit one term. Moving it moves the terms below it too. Field groups attached to the taxonomy show as boxes. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageTerms)] })
export default class EditTerm extends Cossack {
    @State() taxonomy = { name: '', label: '', singular: '', hierarchical: false };
    @State() draft: Draft = { name: '', slug: '', parent: '', description: '', icon: '' };
    @State() parents: { id: string; name: string; depth: number }[] = [];
    @State() errors: Record<string, string> = {};
    @State() error = '';
    @State() found = false;
    /** The field groups attached to the taxonomy, and the term's values for them as control values. */
    @State() fieldGroups: GroupsView = { groups: [], fields: [], options: [] };
    @State() meta: EditorValues = {};
    @State() previews: Record<string, MediaPreview> = {};
    @State() chooser: MediaChooserState = closedChooser();
    private target: MetaTarget | null = null;

    head(): HeadValue {
        return { title: `${__('Edit')} ${this.taxonomy.singular.toLowerCase() || __('term')}` };
    }

    async init() {
        const cms = this.c.get('cms');
        const term = await cms.taxonomies.get(this.c.req.param('id') ?? '');
        if (!term || term.taxonomy !== this.c.req.param('taxonomy')) { this.error = __('This term does not exist.'); this.c.status(404); return; }
        const declaration = cms.taxonomies.declaration(term.taxonomy);
        this.taxonomy = { name: declaration.name, label: declaration.label, singular: declaration.singular, hierarchical: declaration.hierarchical };
        this.draft = { name: term.name, slug: term.slug, parent: term.parent ?? '', description: term.description, icon: term.icon };
        if (declaration.hierarchical) {
            // A term cannot move below itself.
            this.parents = (await cms.taxonomies.tree(term.taxonomy)).filter(entry => !entry.path.startsWith(term.path)).map(entry => ({ id: entry.id, name: entry.name, depth: entry.depth }));
        }
        this.fieldGroups = await groupsView(cms, { kind: 'taxonomy', name: term.taxonomy });
        this.meta = metaValues(this.fieldGroups.fields, term.meta);
        this.previews = await this.metaPreviews(term.meta);
        this.found = true;
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
    setDraft(name: keyof Draft, value: string) {
        // A slug that still matches the name keeps following it.
        const follows = name === 'name' && this.draft.slug === slugify(this.draft.name);
        this.draft = { ...this.draft, [name]: value, ...(follows ? { slug: slugify(value) } : {}) };
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
        if (!hasPermission(this.c.get('principal'), PERMISSIONS.manageTerms)) return;
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
        await this.save(this.draft, this.meta);
        if (this.error) toast.error(this.error); else toast.success(`${this.taxonomy.singular} ${__('updated.')}`);
    }

    @Server()
    async save(draft: Draft, meta: EditorValues) {
        this.errors = {};
        this.error = '';
        const converted = metaInput(this.fieldGroups.fields, meta);
        if (Object.keys(converted.errors).length) { this.errors = converted.errors; this.error = __('Some fields are invalid.'); return; }
        try {
            const term = await this.c.get('cms').taxonomies.update(this.c.req.param('id') ?? '', {
                name: draft.name, slug: draft.slug, description: draft.description, icon: draft.icon, meta: converted.meta, ...(this.taxonomy.hierarchical ? { parent: draft.parent || null } : {}),
            }, { principal: this.c.get('principal') });
            this.draft = { name: term.name, slug: term.slug, parent: term.parent ?? '', description: term.description, icon: term.icon };
            this.meta = metaValues(this.fieldGroups.fields, term.meta);
        } catch (error) {
            this.errors = isCmsError(error) && error.fields ? { ...error.fields } : {};
            this.error = isCmsError(error) ? error.message : __('The term could not be saved.');
        }
    }

    @Server()
    async remove() {
        try {
            await this.c.get('cms').taxonomies.delete(this.c.req.param('id') ?? '', { principal: this.c.get('principal') });
            return this.redirect(`/dashboard/terms/${this.taxonomy.name}`);
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The term could not be deleted.');
        }
    }

    // --- Rendering ----------------------------------------------------------------

    private metaControl(field: EditorField, value: unknown, change: (value: unknown) => void, rows: RowPath, id: string): TemplateResult | null {
        const root = rows[0]?.field ?? field.name;
        const media: MediaHooks = { previews: this.previews, choose: multiple => this.openChooser({ field: root, rows, key: field.name, multiple }) };
        return fieldControl(field, value, change, id, { media });
    }

    private groupBoxes(): TemplateResult | null {
        const { groups, fields, options } = this.fieldGroups;
        if (!groups.length) return null;
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
        if (!this.found) return notice(this.error || __('This term does not exist.'), 'error');
        return html`<div class="max-w-2xl space-y-6">
            ${pageHeader(`${__('Edit')} ${this.taxonomy.singular.toLowerCase()}`, { actions: html`<a href=${`/dashboard/terms/${this.taxonomy.name}`} class="text-sm text-muted-foreground hover:text-foreground">← ${this.taxonomy.label}</a>` })}
            ${this.error ? notice(this.error, 'error') : null}
            <form class="space-y-6" @submit=${(event: Event) => this.submit(event)}>
            ${component(Card, {}, component(CardBody, {}, html`<div class="space-y-4">
                ${component(Field, { label: __('Name'), for: 'term-name', error: this.errors.name,
                    control: attributes => component(Input, { ...attributes, '.value': this.draft.name, '@input': (event: Event) => this.setDraft('name', (event.target as HTMLInputElement).value) }) })}
                ${component(Field, { label: __('Slug'), for: 'term-slug', error: this.errors.slug, hint: __('Follows the name until you change it; lowercase letters, digits and hyphens.'),
                    control: attributes => component(Input, { ...attributes, '.value': this.draft.slug, '@input': (event: Event) => this.setDraft('slug', (event.target as HTMLInputElement).value) }) })}
                ${this.taxonomy.hierarchical ? component(Field, { label: __('Parent'), for: 'term-parent', error: this.errors.parent,
                    control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setDraft('parent', (event.target as HTMLSelectElement).value) }, html`
                        <option value="" ?selected=${!this.draft.parent}>${__('None')}</option>
                        ${this.parents.map(entry => html`<option value=${entry.id} ?selected=${entry.id === this.draft.parent}>${'— '.repeat(entry.depth)}${entry.name}</option>`)}`) }) : null}
                ${component(Field, { label: __('Description'), for: 'term-description', error: this.errors.description,
                    control: attributes => component(Textarea, { ...attributes, rows: 4, '.value': this.draft.description, '@input': (event: Event) => this.setDraft('description', (event.target as HTMLTextAreaElement).value) }) })}
                ${iconSelect('term-icon', this.draft.icon, value => this.setDraft('icon', value), this.errors.icon)}
            </div>`))}
            ${this.groupBoxes()}
            <div class="flex items-center justify-between">
                <button type="button" class="text-sm text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.remove()}>${__('Delete')}</button>
                ${component(Button, { type: 'submit' }, __('Update'))}
            </div>
            </form>
            ${mediaChooser(this.chooser, { search: text => this.searchMedia(text), choose: file => this.chooseFile(file), upload: event => this.uploadFile(event), close: () => { this.chooser = { ...this.chooser, open: false }; } })}
        </div>`;
    }
}
