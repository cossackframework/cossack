import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, NativeSelect, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { bindingPaths, findBlock, flattenBlocks, flattenGroupFields, hasPermission, isCmsError, PERMISSIONS, RESERVED_FIELDS, updateBlock, type Block, type RichTextDoc, type ThemePresets } from '@cossackframework/cms';
import { collectionDraft, definitionOf, type CollectionDraft } from '../../../../../cms/builder';
import { blockPanel } from '../../../../../cms/block-panel';
import { BlockTree } from '../../../../../cms/block-tree';
import { blockFilePreviews, blockOptions, findMedia } from '../../../../../cms/content';
import { blocksInput, controlValue, editorBlocks, editorInput, type BlockOption, type EditorBlock, type EditorField } from '../../../../../cms/editor';
import { bindingChoices, blockFields, moveItem, type BindingChoice, type MediaHooks, type MediaPreview } from '../../../../../cms/field-controls';
import { requireAny } from '../../../../../cms/guards';
import { COLLECTION_ICONS } from '../../../../../cms/icons';
import { closedChooser, mediaChooser, uploadMedia, withFile, type MediaChooserState } from '../../../../../cms/media-chooser';
import { RichTextField, richTextEditors } from '../../../../../cms/rich-text-field';
import { activePresets } from '../../../../../cms/site';
import { styleValues, withStyle, type BlockTab, type StyleValues } from '../../../../../cms/style-controls';
import { iconButton, linkButton, notice, pageHeader } from '../../../../../cms/ui';

/** The template block being edited in the panel. */
interface BlockDialog { id: string; values: Record<string, unknown>; style: StyleValues; tab: BlockTab; errors: Record<string, string> }

/** A field group as the manager lists it: attached in this order, with its fields for the template's bindings. */
interface GroupRow { id: string; title: string; placement: 'main' | 'sidebar'; fields: { name: string; label: string; kind: string }[] }

/** The bindable kind of a field block's type. */
const BINDABLE: Record<string, EditorField['kind']> = { text: 'string', textarea: 'text', markdown: 'text', number: 'number', integer: 'integer', boolean: 'boolean', choice: 'enum', date: 'datetime' };

/**
 * Define a collection in three parts: its features (the standard fields and behaviours, as
 * toggles), the field groups attached to it in order, and the content template new entries
 * start with. Saving changes no data; attaching and detaching groups adds and drops indexes.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class CollectionBuilder extends Cossack {
    @State() draft: CollectionDraft | null = null;
    /** Fields the module declares by hand, which the manager shows but does not edit. */
    @State() builtinFields: string[] = [];
    /** The module's features, which stay on. */
    @State() builtinFeatures: string[] = [];
    @State() builtinTaxonomies: string[] = [];
    /** The groups attached to the collection, in order. */
    @State() groups: GroupRow[] = [];
    /** Groups that exist and are not attached. */
    @State() available: { id: string; title: string }[] = [];
    /** The group picked to attach. */
    @State() attaching = '';
    @State() taxonomies: { name: string; label: string }[] = [];
    @State() blocks: { name: string; label: string }[] = [];
    @State() targets: { name: string; label: string }[] = [];
    @State() message = '';
    @State() error = '';
    @State() confirmDelete = false;
    /** The content template: the blocks a new entry starts with, held as control values while edited. */
    @State() template: EditorBlock[] = [];
    @State() options: BlockOption[] = [];
    @State() previews: Record<string, MediaPreview> = {};
    @State() presets: Required<ThemePresets> = { colors: [], fontSizes: [], spacing: [] };
    @State() dialog: BlockDialog | null = null;
    @State() chooser: MediaChooserState = closedChooser();

    head(): HeadValue {
        return { title: this.draft ? `${this.draft.label} — ${__('Collection')}` : __('Collection') };
    }

    async init() {
        await this.load(this.c.req.param('name') ?? '');
        if (this.c.req.query('created') === '1') this.message = __('Collection created. Add its fields, then save.');
    }

    @Server()
    async load(name: string) {
        const cms = this.c.get('cms');
        let definition;
        try { definition = cms.collection(name); }
        catch { this.error = __('This collection does not exist.'); this.c.status(404); return; }
        if (definition.managed) { this.error = __('This collection is managed by its module and has its own screens.'); this.c.status(404); return; }
        const builtin = cms.builtinCollection(name);
        this.draft = collectionDraft(definition);
        this.builtinTaxonomies = [...(builtin?.taxonomies ?? [])];
        this.builtinFields = Object.keys(builtin?.fields ?? {});
        this.builtinFeatures = Object.entries(builtin?.features ?? {}).filter(([, on]) => on).map(([feature]) => feature);
        const attached = cms.fieldGroupsFor({ kind: 'collection', name });
        this.groups = attached.map(group => ({ id: group.id, title: group.title, placement: group.placement ?? 'main', fields: this.groupFields(group.blocks) }));
        this.available = (await cms.fieldGroups.all()).filter(group => !attached.some(entry => entry.id === group.id)).map(group => ({ id: group.id, title: group.title }));
        this.attaching = '';
        this.taxonomies = cms.taxonomies.declarations.map(taxonomy => ({ name: taxonomy.name, label: taxonomy.label }));
        this.blocks = (await cms.blocks()).map(block => ({ name: block.name, label: block.label }));
        this.targets = cms.collections().map(collection => ({ name: collection.name, label: collection.label }));
        // The template is built from the same blocks as entries, patterns, form inputs and field blocks aside.
        const options = await blockOptions(cms);
        this.options = options.filter(option => option.name !== 'core/pattern' && !option.input && !option.field);
        this.template = editorBlocks((definition.template ?? []) as EditorBlock[], options);
        this.previews = await blockFilePreviews(cms, this.template);
        this.presets = await activePresets(cms);
    }

    @Client()
    setDraft<K extends keyof CollectionDraft>(key: K, value: CollectionDraft[K]) {
        if (this.draft) this.draft = { ...this.draft, [key]: value };
    }

    @Client()
    toggleTaxonomy(name: string, checked: boolean) {
        if (!this.draft) return;
        this.setDraft('taxonomies', checked ? [...new Set([...this.draft.taxonomies, name])] : this.draft.taxonomies.filter(entry => entry !== name));
    }

    /** A group's fields at any depth, with the kind a template binding may show. */
    private groupFields(blocks: readonly Block[]): GroupRow['fields'] {
        return flattenGroupFields(blocks).flatMap(block => {
            const name = String(block.data.name ?? '');
            return name ? [{ name, label: String(block.data.label ?? name), kind: BINDABLE[block.type.replace(/^field\//, '')] ?? '' }] : [];
        });
    }

    @Client()
    moveGroup(index: number, delta: number) {
        this.groups = moveItem(this.groups, index, delta);
    }

    @Client()
    detachGroup(id: string) {
        const group = this.groups.find(entry => entry.id === id);
        this.groups = this.groups.filter(entry => entry.id !== id);
        if (group) this.available = [...this.available, { id: group.id, title: group.title }];
    }

    /** Attach a group: its fields are read on the server, so the template's bindings know them. */
    @Server()
    async attachGroup(id: string) {
        if (!hasPermission(this.c.get('principal'), PERMISSIONS.manageCollections) || this.groups.some(entry => entry.id === id)) return;
        const group = await this.c.get('cms').fieldGroups.get(id);
        if (!group) return;
        this.groups = [...this.groups, { id: group.id, title: group.title, placement: group.placement ?? 'main', fields: this.groupFields(group.blocks) }];
        this.available = this.available.filter(entry => entry.id !== id);
        this.attaching = '';
    }

    @Client()
    async submit() {
        if (!this.draft) return;
        await this.save(this.draft, this.groups.map(group => group.id), this.template);
        if (this.error) toast.error(this.error); else toast.success(__('Collection saved.'));
    }

    @Server()
    async save(draft: CollectionDraft, groups: string[], template: EditorBlock[] = []) {
        this.error = '';
        this.message = '';
        // The block types are read again here: the template is checked against what the host has.
        const options = await blockOptions(this.c.get('cms'));
        const types = new Map(options.map(option => [option.name, option]));
        const converted = blocksInput(template, types);
        if ('error' in converted) { this.error = `${__('Content template')}: ${converted.error}`; return; }
        try {
            const saved = await this.c.get('cms').saveCollection(definitionOf(draft, converted.value as Block[]), this.c.get('principal'), { groups: groups.map((id, order) => ({ id, order })) });
            await this.load(saved.name);
            this.message = __('Collection saved.');
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The collection could not be saved.');
        }
    }

    @Server()
    async remove() {
        try {
            await this.c.get('cms').deleteCollection(this.c.req.param('name') ?? '', this.c.get('principal'));
            return this.redirect('/dashboard/collections');
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The collection could not be deleted.');
        }
    }

    // --- The content template ---------------------------------------------------------

    @Client()
    private changeTemplate(blocks: EditorBlock[]) {
        this.template = blocks;
    }

    @Client()
    editTemplateBlock(id: string) {
        const block = findBlock(this.template, id);
        const option = this.options.find(entry => entry.name === block?.type);
        if (!block || !option) return;
        this.dialog = { id, errors: {}, tab: 'general', style: styleValues(block), values: Object.fromEntries(option.fields.filter(field => field.kind !== 'richtext').map(field => [field.name, block.data[field.name] ?? controlValue(field, field.defaultValue)])) };
    }

    @Client()
    setDialogValue(name: string, value: unknown) {
        if (this.dialog) this.applyDialog({ ...this.dialog, values: { ...this.dialog.values, [name]: value }, errors: { ...this.dialog.errors, [name]: '' } });
    }

    @Client()
    setDialogStyle(style: StyleValues) {
        if (this.dialog) this.applyDialog({ ...this.dialog, style });
    }

    /** The panel's values and style go into the template block at once; a value its field cannot take stays in the panel with its message. */
    @Client()
    applyDialog(dialog: BlockDialog) {
        const block = findBlock(this.template, dialog.id);
        const option = this.options.find(entry => entry.name === block?.type);
        if (!block || !option) return;
        const fields = option.fields.filter(field => field.kind !== 'richtext');
        const { input, errors } = editorInput(fields, dialog.values);
        this.dialog = { ...dialog, errors: { ...dialog.errors, ...errors } };
        this.template = updateBlock(this.template, dialog.id, entry => withStyle({ ...entry, data: { ...Object.fromEntries(Object.entries(entry.data).filter(([name]) => option.fields.find(field => field.name === name)?.kind === 'richtext')), ...input } }, dialog.style));
    }

    /** The collection's fields a template block's text may show (`{{ $.price }}`): the title, the excerpt and the attached groups' text-like fields. */
    private bindings(): BindingChoice[] {
        const own = this.groups.flatMap(group => group.fields).flatMap(field => field.kind ? [{ name: field.name, label: field.label, kind: field.kind as EditorField['kind'], media: false }] : []);
        return bindingChoices([{ name: 'title', label: __('Title'), kind: 'string', media: false }, ...(this.draft?.excerpt ? [{ name: 'excerpt', label: __('Excerpt'), kind: 'text' as const, media: false }] : []), ...own]);
    }

    /** Template bindings that name no field of the collection: a detached group's, or a renamed one. The site shows them empty. */
    private unresolvedBindings(): string[] {
        const known = new Set([...RESERVED_FIELDS, ...(this.draft?.taxonomies ?? []), ...this.builtinFields, ...this.groups.flatMap(group => group.fields.map(field => field.name))]);
        const paths = flattenBlocks(this.template as unknown as Block[]).flatMap(block => Object.values(block.data).flatMap(value => bindingPaths(value)));
        return [...new Set(paths.filter(path => !known.has(path.split('.')[0]!)))];
    }

    @Server()
    async searchMedia(search: string) {
        if (!hasPermission(this.c.get('principal'), PERMISSIONS.manageCollections)) return;
        this.chooser = { ...this.chooser, search, items: await findMedia(this.c.get('cms'), search) };
    }

    @Client()
    async openChooser(field: string, multiple: boolean) {
        this.chooser = { ...this.chooser, open: true, field, multiple };
        await this.searchMedia(this.chooser.search);
    }

    @Client()
    chooseFile(file: MediaPreview) {
        this.previews = { ...this.previews, [file.id]: file };
        if (this.chooser.field.startsWith('editor:')) {
            richTextEditors.get(this.chooser.field.slice('editor:'.length))?.insertImage({ src: file.url, alt: file.alt || file.title, mediaId: file.id });
            this.chooser = { ...this.chooser, open: false };
            return;
        }
        this.setDialogValue(this.chooser.field, withFile(this.dialog?.values[this.chooser.field], file.id, this.chooser.multiple));
        if (!this.chooser.multiple) this.chooser = { ...this.chooser, open: false };
    }

    @Client()
    async uploadFile(event: Event) {
        const { files, error } = await uploadMedia(event.currentTarget as HTMLInputElement);
        if (error) toast.error(error);
        for (const file of files) this.chooseFile(file);
        await this.searchMedia('');
    }

    /** A rich text block's text, written in the tree: the words every new entry starts with. */
    private templateControl(field: EditorField, value: unknown, change: (value: unknown) => void, id: string): TemplateResult | null {
        if (field.kind !== 'richtext') return null;
        return component(RichTextField, {
            id, label: field.label, value: (value as RichTextDoc | null) ?? null, blocks: [], placeholder: __('Starting text, or leave it empty…'), onChange: (doc: RichTextDoc) => change(doc),
            onMedia: () => this.openChooser(`editor:${id}`, false), onInsertBlock: () => undefined, onEditBlock: () => undefined,
        });
    }

    private templateCard(draft: CollectionDraft): TemplateResult {
        const dialog = this.dialog;
        const block = dialog ? findBlock(this.template, dialog.id) : undefined;
        const option = this.options.find(entry => entry.name === block?.type) ?? null;
        const media = (field: string): MediaHooks => ({ previews: this.previews, choose: multiple => this.openChooser(field, multiple) });
        const fields = option ? { ...option, fields: option.fields.filter(field => field.kind !== 'richtext') } : null;
        const unresolved = this.unresolvedBindings();
        return html`${component(Card, {}, html`
            ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Content template')}</h2>
                <p class="text-sm text-muted-foreground">${__('The blocks every new entry starts with, in this order: a structure such as a heading, an image and a rich text, with data blocks for what the entry stores. Editors fill them in.')}</p>`)}
            ${component(CardBody, { class: 'space-y-4' }, html`
                ${unresolved.length ? notice(`${__('These bindings name no field of the collection and show nothing on the site')}: ${unresolved.map(path => `{{ $.${path} }}`).join(', ')}.`, 'error') : null}
                ${component(BlockTree, {
                    id: 'template', blocks: this.template, options: this.options, allowed: [], previews: this.previews,
                    onChange: (blocks: EditorBlock[]) => this.changeTemplate(blocks), onEdit: (id: string) => this.editTemplateBlock(id),
                    control: (field: EditorField, value: unknown, change: (value: unknown) => void, _block: EditorBlock, id: string) => this.templateControl(field, value, change, id),
                })}
                ${this.template.length ? component(Field, { label: __('Editors may'), for: 'collection-template-lock', control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setDraft('templateLock', (event.target as HTMLSelectElement).value as CollectionDraft['templateLock']) }, html`
                    <option value="" ?selected=${!draft.templateLock}>${__('Change the blocks freely')}</option>
                    <option value="insert" ?selected=${draft.templateLock === 'insert'}>${__('Reorder the blocks, but not add or remove any')}</option>
                    <option value="all" ?selected=${draft.templateLock === 'all'}>${__('Only fill the blocks in')}</option>`) }) : null}`)}
        `)}
        ${blockPanel({
            id: 'template-block', open: Boolean(dialog && option), option, tab: dialog?.tab ?? 'general', style: dialog?.style ?? styleValues({}), presets: this.presets,
            onTab: tab => { if (this.dialog) this.dialog = { ...this.dialog, tab }; }, onStyle: style => this.setDialogStyle(style),
            onClose: () => { this.dialog = null; },
            general: dialog && fields ? (fields.fields.length ? blockFields(fields, dialog.values, (name, value) => this.setDialogValue(name, value), `template-${dialog.id}`, media, dialog.errors, this.bindings())
                : html`<p class="text-sm text-muted-foreground">${__('This block has no settings.')}</p>`) : html``,
        })}
        ${mediaChooser(this.chooser, { search: text => this.searchMedia(text), choose: file => this.chooseFile(file), upload: event => this.uploadFile(event), close: () => { this.chooser = { ...this.chooser, open: false }; } })}`;
    }

    private check(label: string, checked: boolean, change: (checked: boolean) => void, options: { disabled?: boolean; hint?: string } = {}): TemplateResult {
        return html`<label class=${`flex items-start gap-2 text-sm ${options.disabled ? 'text-muted-foreground' : 'text-foreground cursor-pointer'}`}>
            ${component(Checkbox, { checked, disabled: options.disabled === true, '@change': (event: Event) => change((event.target as HTMLInputElement).checked) })}
            <span>${label}${options.hint ? html`<span class="block text-xs text-muted-foreground">${options.hint}</span>` : null}</span>
        </label>`;
    }

    /** The attached groups, in order, with Attach and New. */
    private groupsCard(draft: CollectionDraft): TemplateResult {
        const row = (group: GroupRow, index: number) => html`<li class="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2" data-group=${group.id}>
            <div class="min-w-0 flex-1">
                <a href=${`/dashboard/field-groups/${group.id}`} class="font-medium text-foreground hover:text-primary no-underline">${group.title}</a>
                <p class="text-xs text-muted-foreground">${group.fields.length === 1 ? __('1 field') : `${group.fields.length} ${__('fields')}`} · ${group.placement === 'sidebar' ? __('Sidebar') : __('Main column')}</p>
            </div>
            ${iconButton(`group-${group.id}-up`, 'arrow-up', `${__('Move up')} ${group.title}`, () => this.moveGroup(index, -1), { disabled: index === 0 })}
            ${iconButton(`group-${group.id}-down`, 'arrow-down', `${__('Move down')} ${group.title}`, () => this.moveGroup(index, 1), { disabled: index === this.groups.length - 1 })}
            ${iconButton(`group-${group.id}-remove`, 'close-circle', `${__('Remove')} ${group.title}`, () => this.detachGroup(group.id), { danger: true })}
        </li>`;
        return component(Card, {}, html`
            ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Field groups')}</h2>
                <p class="text-sm text-muted-foreground">${__('The boxes of fields entries of this collection have, in this order. A group can show on several collections; edit its fields on its own page.')}
                ${this.builtinFields.length ? ` ${__('Built-in fields')}: ${this.builtinFields.join(', ')}.` : ''}</p>`)}
            ${component(CardBody, { class: 'space-y-4' }, html`
                ${this.groups.length ? html`<ol class="space-y-2">${this.groups.map(row)}</ol>` : html`<p class="text-sm text-muted-foreground">${__('No field groups attached. Entries have the features above only.')}</p>`}
                <div class="flex flex-wrap items-end gap-2">
                    ${this.available.length ? html`<div class="min-w-48 flex-1">${component(Field, { label: __('Attach a group'), for: 'collection-attach', control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => { this.attaching = (event.target as HTMLSelectElement).value; } }, html`
                        <option value="" ?selected=${!this.attaching}>${__('Choose a field group…')}</option>
                        ${this.available.map(group => html`<option value=${group.id} ?selected=${group.id === this.attaching}>${group.title}</option>`)}`) })}</div>
                    ${component(Button, { type: 'button', variant: 'outline', disabled: !this.attaching, '@click': () => this.attachGroup(this.attaching) }, __('Attach'))}` : null}
                    ${linkButton(__('New field group'), `/dashboard/field-groups/new?collection=${draft.name}`, 'outline')}
                </div>`)}`);
    }

    render() {
        const draft = this.draft;
        if (!draft) return notice(this.error || __('This collection does not exist.'), 'error');
        const locked = (feature: string) => draft.builtin && this.builtinFeatures.includes(feature);
        const control = (key: 'label' | 'singular' | 'description' | 'path', label: string, hint?: string) => component(Field, { label, for: `collection-${key}`, ...(hint ? { hint } : {}),
            control: attributes => component(Input, { ...attributes, '.value': draft[key], '@input': (event: Event) => this.setDraft(key, (event.target as HTMLInputElement).value) }) });
        return html`<div class="space-y-6">
            ${pageHeader(draft.label, {
                description: `${__('Collection')} cms/${draft.name}${draft.builtin ? ` · ${__('built in')}` : ''}`,
                actions: html`<a href=${`/dashboard/content/${draft.name}`} class="text-sm text-primary hover:underline">${__('View entries')}</a>
                    ${component(Button, { type: 'button', '@click': () => this.submit() }, __('Save collection'))}`,
            })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div class="space-y-6">
                    ${component(Card, {}, html`
                        ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Features')}</h2>
                            <p class="text-sm text-muted-foreground">${__('The standard fields and behaviours every entry has, with fixed names themes and code rely on. Every entry has a title.')}</p>`)}
                        ${component(CardBody, {}, html`<div class="grid gap-x-8 gap-y-3 md:grid-cols-2">
                            ${this.check(__('Content'), draft.content, checked => this.setDraft('content', checked), { disabled: locked('content'), hint: __('Blocks: headings, images and rich text, which the content template starts.') })}
                            ${this.check(__('Excerpt'), draft.excerpt, checked => this.setDraft('excerpt', checked), { disabled: locked('excerpt'), hint: __('A short summary for lists, feeds and link previews.') })}
                            ${this.check(__('Featured image'), draft.featuredImage, checked => this.setDraft('featuredImage', checked), { disabled: locked('featuredImage'), hint: __('One image from the media library, in the sidebar.') })}
                            ${this.check(__('Revisions'), draft.revisions, checked => this.setDraft('revisions', checked), { hint: __('Keep every version of an entry to compare and restore.') })}
                            ${this.check(__('Generate slugs from titles'), draft.slug, checked => this.setDraft('slug', checked), { disabled: draft.builtin })}
                            ${this.check(__('Drafts and publishing'), draft.publishable, checked => this.setDraft('publishable', checked), { disabled: draft.builtin, hint: __('Visitors see published entries only.') })}
                            ${this.check(__('Nested entries'), draft.hierarchical, checked => this.setDraft('hierarchical', checked), { disabled: draft.builtin, hint: __('Entries can have a parent, like pages.') })}
                            ${this.check(__('Comments'), draft.comments, checked => this.setDraft('comments', checked), { hint: __('Visitors can comment on published entries; Settings → Discussion moderates them.') })}
                        </div>
                        <div class="mt-5 border-t border-border pt-4">
                            <h3 class="mb-2 text-sm font-semibold text-foreground">${__('Taxonomies')}</h3>
                            <div class="grid gap-x-8 gap-y-2 md:grid-cols-2">
                                ${this.taxonomies.map(taxonomy => this.check(taxonomy.label, draft.taxonomies.includes(taxonomy.name), checked => this.toggleTaxonomy(taxonomy.name, checked), { disabled: this.builtinTaxonomies.includes(taxonomy.name) }))}
                            </div>
                            <a href="/dashboard/taxonomies" class="mt-2 inline-block text-sm text-primary hover:underline">${__('Manage taxonomies')}</a>
                        </div>`)}
                    `)}
                    ${this.groupsCard(draft)}
                    ${draft.content ? this.templateCard(draft) : null}
                </div>
                <aside class="space-y-6">
                    ${component(Card, {}, component(CardBody, { class: 'space-y-4' }, html`
                        <h2 class="text-base font-semibold text-foreground">${__('Settings')}</h2>
                        ${control('label', __('Plural name'))}
                        ${control('singular', __('Singular name'))}
                        ${control('description', __('Description'))}
                        ${component(Field, { label: __('Icon'), for: 'collection-icon', control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setDraft('icon', (event.target as HTMLSelectElement).value) }, html`
                            ${COLLECTION_ICONS.map(name => html`<option value=${name} ?selected=${name === draft.icon}>${name}</option>`)}`) })}
                        ${this.check(__('Show entries on the site'), draft.public, checked => this.setDraft('public', checked), { disabled: draft.builtin && draft.name === 'pages' })}
                        ${draft.public && !(draft.builtin && draft.name === 'pages') ? control('path', __('URL path'), draft.path.trim()
                            ? `${__('Entries at')} /${draft.path.trim()}/${draft.slug ? 'slug' : 'id'}`
                            : `${__('Entries at the site root')}: /${draft.slug ? 'slug' : 'id'}. ${__('Slugs stay unique across pages and other root collections.')}`) : null}
                        ${draft.publishable ? null : component(Field, { label: __('Who can read entries'), for: 'collection-visibility', control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setDraft('visibility', (event.target as HTMLSelectElement).value as 'public' | 'private') }, html`
                            <option value="private" ?selected=${draft.visibility === 'private'}>${__('Editors only')}</option>
                            <option value="public" ?selected=${draft.visibility === 'public'}>${__('Everyone')}</option>`) })}
                    `))}
                    ${draft.builtin ? null : component(Card, {}, component(CardBody, { class: 'space-y-3' }, html`
                        <h2 class="text-base font-semibold text-destructive">${__('Delete collection')}</h2>
                        <p class="text-sm text-muted-foreground">${__('Deletes the collection, its table and every entry.')}</p>
                        ${component(Button, { type: 'button', variant: 'destructive', size: 'sm', '@click': () => { this.confirmDelete = true; } }, __('Delete collection'))}
                    `))}
                </aside>
            </div>
            ${component(AlertDialog, {
                id: 'delete-collection-dialog', open: this.confirmDelete, title: `${__('Delete')} ${draft.label}?`,
                description: __('Every entry of this collection is deleted with it. This cannot be undone.'),
                cancelLabel: __('Cancel'), actionLabel: __('Delete'), actionVariant: 'destructive',
                onAction: () => { this.confirmDelete = false; void this.remove(); }, onOpenChange: () => { this.confirmDelete = false; },
            })}
        </div>`;
    }
}
