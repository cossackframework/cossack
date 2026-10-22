import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, NativeSelect, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { CORE_FIELDS, findBlock, hasPermission, isCmsError, layoutOf, PERMISSIONS, updateBlock, type Block, type RichTextDoc, type ThemePresets } from '@cossackframework/cms';
import { collectionDraft, definitionOf, type CollectionDraft } from '../../../../../cms/builder';
import { FieldGroupEditor } from '../../../../../cms/field-group-editor';
import { blockPanel } from '../../../../../cms/block-panel';
import { BlockTree } from '../../../../../cms/block-tree';
import { blockFilePreviews, blockOptions, findMedia } from '../../../../../cms/content';
import { blocksInput, controlValue, editorBlocks, editorInput, type BlockOption, type EditorBlock, type EditorField } from '../../../../../cms/editor';
import { blockFields, type MediaHooks, type MediaPreview } from '../../../../../cms/field-controls';
import { requireAny } from '../../../../../cms/guards';
import { COLLECTION_ICONS } from '../../../../../cms/icons';
import { closedChooser, mediaChooser, uploadMedia, withFile, type MediaChooserState } from '../../../../../cms/media-chooser';
import { RichTextField, richTextEditors } from '../../../../../cms/rich-text-field';
import { activePresets } from '../../../../../cms/site';
import { styleValues, withStyle, type BlockTab, type StyleValues } from '../../../../../cms/style-controls';
import { notice, pageHeader } from '../../../../../cms/ui';

/** The template block being edited in the panel. */
interface BlockDialog { id: string; values: Record<string, unknown>; style: StyleValues; tab: BlockTab; errors: Record<string, string> }

/**
 * Define a collection: its names, URL, publishing, nesting, taxonomies and fields. The fields
 * are laid out in the block tree as a field group: field blocks between columns, tabs and
 * headings. Saving changes no data; new unique, search and term fields add indexes.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class CollectionBuilder extends Cossack {
    @State() draft: CollectionDraft | null = null;
    /** The fields' layout: field blocks and layout blocks, held as control values while edited. */
    @State() layout: EditorBlock[] = [];
    /** Names of the module's own fields, whose settings the host keeps. */
    @State() builtinFields: string[] = [];
    @State() builtinTaxonomies: string[] = [];
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
        const builtin = cms.builtinCollection(name);
        this.draft = collectionDraft(definition);
        this.builtinTaxonomies = [...(builtin?.taxonomies ?? [])];
        this.builtinFields = Object.keys(builtin?.fields ?? {});
        this.taxonomies = cms.taxonomies.declarations.map(taxonomy => ({ name: taxonomy.name, label: taxonomy.label }));
        this.blocks = (await cms.blocks()).map(block => ({ name: block.name, label: block.label }));
        this.targets = cms.collections().map(collection => ({ name: collection.name, label: collection.label }));
        // The template is built from the same blocks as entries, patterns and form inputs aside; the layout from the field and layout blocks.
        const options = await blockOptions(cms);
        this.options = options.filter(option => option.name !== 'core/pattern' && !option.input);
        this.layout = editorBlocks((definition.layout ?? layoutOf(definition.fields, definition.fieldOrder ?? [])) as EditorBlock[], options);
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

    @Client()
    private changeLayout(blocks: EditorBlock[]) {
        this.layout = blocks;
    }

    @Client()
    async submit() {
        if (!this.draft) return;
        await this.save(this.draft, this.layout, this.template);
        if (this.error) toast.error(this.error); else toast.success(__('Collection saved.'));
    }

    @Server()
    async save(draft: CollectionDraft, layout: EditorBlock[], template: EditorBlock[] = []) {
        this.error = '';
        this.message = '';
        // The block types are read again here: the layout and the template are checked against what the host has.
        const options = await blockOptions(this.c.get('cms'));
        const types = new Map(options.map(option => [option.name, option]));
        const fields = blocksInput(layout, types);
        if ('error' in fields) { this.error = `${__('Fields')}: ${fields.error}`; return; }
        const converted = blocksInput(template, types);
        if ('error' in converted) { this.error = `${__('Content template')}: ${converted.error}`; return; }
        try {
            const saved = await this.c.get('cms').saveCollection(definitionOf(draft, fields.value as Block[], converted.value as Block[]), this.c.get('principal'));
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
        if (this.dialog) this.dialog = { ...this.dialog, values: { ...this.dialog.values, [name]: value }, errors: { ...this.dialog.errors, [name]: '' } };
    }

    @Client()
    applyDialog() {
        const dialog = this.dialog;
        const block = dialog ? findBlock(this.template, dialog.id) : undefined;
        const option = this.options.find(entry => entry.name === block?.type);
        if (!dialog || !block || !option) return;
        const fields = option.fields.filter(field => field.kind !== 'richtext');
        const { input, errors } = editorInput(fields, dialog.values);
        for (const field of fields) if (field.required && (input[field.name] === undefined || input[field.name] === '' || input[field.name] === null)) errors[field.name] ??= __('is required.');
        if (Object.keys(errors).length) { this.dialog = { ...dialog, errors }; return; }
        this.template = updateBlock(this.template, dialog.id, entry => withStyle({ ...entry, data: { ...Object.fromEntries(Object.entries(entry.data).filter(([name]) => option.fields.find(field => field.name === name)?.kind === 'richtext')), ...dialog.values } }, dialog.style));
        this.dialog = null;
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
        return html`${component(Card, {}, html`
            ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Content template')}</h2>
                <p class="text-sm text-muted-foreground">${__('The blocks every new entry starts with, in this order: a structure such as a heading, an image and a rich text, with data blocks for what the entry stores. Editors fill them in.')}</p>`)}
            ${component(CardBody, { class: 'space-y-4' }, html`
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
            onTab: tab => { if (this.dialog) this.dialog = { ...this.dialog, tab }; }, onStyle: style => { if (this.dialog) this.dialog = { ...this.dialog, style }; },
            onApply: () => this.applyDialog(), onClose: () => { this.dialog = null; },
            general: dialog && fields ? (fields.fields.length ? blockFields(fields, dialog.values, (name, value) => this.setDialogValue(name, value), `template-${dialog.id}`, media, dialog.errors)
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

    render() {
        const draft = this.draft;
        if (!draft) return notice(this.error || __('This collection does not exist.'), 'error');
        const core = [__('Title'), ...(draft.slug ? [__('Slug')] : []), ...(draft.publishable ? [__('Status'), __('Publication time')] : []), ...(draft.hierarchical ? [__('Parent'), __('Order')] : [])];
        const scope = [...CORE_FIELDS, ...draft.taxonomies].map(name => ({ name, label: name }));
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
                        ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Fields')}</h2>
                            <p class="text-sm text-muted-foreground">${__('Every entry has')} ${core.join(', ')}. ${__('Add the fields this collection needs, laid out with columns, tabs and headings as the editor should show them.')}
                            ${this.builtinFields.length ? ` ${__('Built-in fields keep their settings')}: ${this.builtinFields.join(', ')}.` : ''}</p>`)}
                        ${component(CardBody, {}, component(FieldGroupEditor, { id: 'layout', blocks: this.layout, options: this.options, scope, onChange: (blocks: EditorBlock[]) => this.changeLayout(blocks) }))}
                    `)}
                    ${this.layout.some(block => block.type === 'field/blocks') || this.template.length ? this.templateCard(draft) : null}
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
                        ${this.check(__('Generate slugs from titles'), draft.slug, checked => this.setDraft('slug', checked), { disabled: draft.builtin })}
                        ${this.check(__('Drafts and publishing'), draft.publishable, checked => this.setDraft('publishable', checked), { disabled: draft.builtin, hint: __('Visitors see published entries only.') })}
                        ${draft.publishable ? null : component(Field, { label: __('Who can read entries'), for: 'collection-visibility', control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setDraft('visibility', (event.target as HTMLSelectElement).value as 'public' | 'private') }, html`
                            <option value="private" ?selected=${draft.visibility === 'private'}>${__('Editors only')}</option>
                            <option value="public" ?selected=${draft.visibility === 'public'}>${__('Everyone')}</option>`) })}
                        ${this.check(__('Nested entries'), draft.hierarchical, checked => this.setDraft('hierarchical', checked), { disabled: draft.builtin, hint: __('Entries can have a parent, like pages.') })}
                        ${this.check(__('Comments'), draft.comments, checked => this.setDraft('comments', checked), { hint: __('Visitors can comment on published entries; Settings → Discussion moderates them.') })}
                    `))}
                    ${component(Card, {}, component(CardBody, { class: 'space-y-3' }, html`
                        <h2 class="text-base font-semibold text-foreground">${__('Taxonomies')}</h2>
                        ${this.taxonomies.map(taxonomy => this.check(taxonomy.label, draft.taxonomies.includes(taxonomy.name), checked => this.toggleTaxonomy(taxonomy.name, checked), { disabled: this.builtinTaxonomies.includes(taxonomy.name) }))}
                        <a href="/dashboard/taxonomies" class="text-sm text-primary hover:underline">${__('Manage taxonomies')}</a>
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
