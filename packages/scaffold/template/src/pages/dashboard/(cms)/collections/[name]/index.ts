import { Cossack, Page, State, ClientState, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, NativeSelect, Textarea, toast } from '@cossackframework/ui';
import { html, component, repeat, type TemplateResult } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { collectionDraft, definitionOf, draftOf, emptyDraft, fieldName, FIELD_TYPES, moveField, type CollectionDraft, type FieldDraft, type FieldType } from '../../../../../cms/builder';
import { requireAny } from '../../../../../cms/guards';
import { COLLECTION_ICONS } from '../../../../../cms/icons';
import { notice, pageHeader } from '../../../../../cms/ui';

/** A field being dragged: where it came from, where it would drop, and the drop line. */
interface Drag { from: number; to: number; y: number; moved: boolean }

/**
 * Define a collection: its names, URL, publishing, nesting, taxonomies and fields. Saving
 * changes no data; new unique, search and term fields add indexes. Fields are ordered by
 * dragging their handles, or with the arrow keys on a handle.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class CollectionBuilder extends Cossack {
    @State() draft: CollectionDraft | null = null;
    @State() fields: FieldDraft[] = [];
    @State() saved: string[] = [];
    @State() builtinTaxonomies: string[] = [];
    @State() taxonomies: { name: string; label: string }[] = [];
    @State() blocks: { name: string; label: string }[] = [];
    @State() targets: { name: string; label: string }[] = [];
    @State() open: Record<string, boolean> = {};
    @State() adding = { label: '', type: 'text' as FieldType };
    @State() message = '';
    @State() error = '';
    @State() confirmDelete = false;
    @ClientState() drag: Drag | null = null;
    @ClientState() announcement = '';
    private rowElements = new Map<string, HTMLElement>();
    private list?: HTMLElement;
    private pointer: { id: number; y: number; tops: number[]; bottoms: number[] } | null = null;

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
        this.fields = Object.entries(definition.fields).map(([field, declaration]) => draftOf(field, declaration, Boolean(builtin && Object.hasOwn(builtin.fields, field))));
        this.saved = this.fields.map(entry => entry.name);
        this.taxonomies = cms.taxonomies.declarations.map(taxonomy => ({ name: taxonomy.name, label: taxonomy.label }));
        this.blocks = (await cms.blocks()).map(block => ({ name: block.name, label: block.label }));
        this.targets = cms.collections().map(collection => ({ name: collection.name, label: collection.label }));
    }

    @Client()
    setDraft<K extends keyof CollectionDraft>(key: K, value: CollectionDraft[K]) {
        if (this.draft) this.draft = { ...this.draft, [key]: value };
    }

    @Client()
    setField<K extends keyof FieldDraft>(index: number, key: K, value: FieldDraft[K]) {
        this.fields = this.fields.map((entry, position) => {
            if (position !== index) return entry;
            const next = { ...entry, [key]: value };
            // Unsaved fields take their name from the label.
            if (key === 'label' && !this.saved.includes(entry.name)) next.name = fieldName(String(value));
            return next;
        });
    }

    @Client()
    toggleTaxonomy(name: string, checked: boolean) {
        if (!this.draft) return;
        this.setDraft('taxonomies', checked ? [...new Set([...this.draft.taxonomies, name])] : this.draft.taxonomies.filter(entry => entry !== name));
    }

    @Client()
    addField(event: Event) {
        event.preventDefault();
        if (!this.adding.label.trim()) return;
        const draft = emptyDraft(this.adding.label, this.adding.type);
        if (this.fields.some(entry => entry.name === draft.name)) { toast.error(__('A field with this name already exists.')); return; }
        this.fields = [...this.fields, draft];
        this.open = { ...this.open, [draft.key]: true };
        this.adding = { label: '', type: this.adding.type };
    }

    /** Move a field and announce its new place to screen readers. */
    @Client()
    placeField(from: number, to: number) {
        if (to < 0 || to >= this.fields.length || to === from) return;
        const entry = this.fields[from]!;
        this.fields = moveField(this.fields, from, to);
        this.announcement = `${entry.label || entry.name}: ${__('position')} ${to + 1} ${__('of')} ${this.fields.length}`;
    }

    // --- Dragging ----------------------------------------------------------------

    @Client()
    rowRef(key: string, element: Element | undefined) {
        if (element) this.rowElements.set(key, element as HTMLElement); else this.rowElements.delete(key);
    }

    @Client()
    listRef(element: Element | undefined) {
        this.list = element as HTMLElement | undefined;
    }

    @Client()
    startDrag(event: PointerEvent, index: number) {
        if (event.button !== 0 || !this.list) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        const top = this.list.getBoundingClientRect().top;
        const rects = this.fields.map(entry => this.rowElements.get(entry.key)?.getBoundingClientRect());
        this.pointer = { id: event.pointerId, y: event.clientY, tops: rects.map(rect => (rect?.top ?? 0) - top), bottoms: rects.map(rect => (rect?.bottom ?? 0) - top) };
        this.drag = { from: index, to: index, y: 0, moved: false };
    }

    @Client()
    moveDrag(event: PointerEvent) {
        const pointer = this.pointer;
        const drag = this.drag;
        if (!pointer || !drag || event.pointerId !== pointer.id || !this.list) return;
        if (!drag.moved && Math.abs(event.clientY - pointer.y) < 4) return;
        const y = event.clientY - this.list.getBoundingClientRect().top;
        // Positions among the other fields: the drop goes before the first whose middle is below the pointer.
        const rest = this.fields.map((_, index) => index).filter(index => index !== drag.from);
        let to = 0;
        while (to < rest.length && (pointer.tops[rest[to]!]! + pointer.bottoms[rest[to]!]!) / 2 < y) to++;
        const line = to < rest.length ? pointer.tops[rest[to]!]! : pointer.bottoms[rest.at(-1) ?? drag.from] ?? 0;
        if (drag.to !== to || !drag.moved) this.drag = { ...drag, to, y: line - 4, moved: true };
        if (event.clientY < 60) window.scrollBy(0, -12);
        else if (event.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    }

    @Client()
    endDrag(event: PointerEvent) {
        const drag = this.drag;
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        this.pointer = null;
        this.drag = null;
        if (drag?.moved) this.placeField(drag.from, drag.to);
    }

    @Client()
    cancelDrag() {
        this.pointer = null;
        this.drag = null;
    }

    @Client()
    handleKey(event: KeyboardEvent, index: number) {
        if (event.key === 'Escape' && this.drag) { this.cancelDrag(); return; }
        const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (!delta) return;
        event.preventDefault();
        this.placeField(index, index + delta);
        // Keep the focus on the moved field's handle.
        const key = this.fields[index + delta]?.key;
        requestAnimationFrame(() => (this.rowElements.get(key ?? '')?.querySelector('[data-handle]') as HTMLElement | null)?.focus());
    }

    @Client()
    removeField(index: number) {
        this.fields = this.fields.filter((_, position) => position !== index);
    }

    @Client()
    async submit() {
        if (!this.draft) return;
        await this.save(this.draft, this.fields);
        if (this.error) toast.error(this.error); else toast.success(__('Collection saved.'));
    }

    @Server()
    async save(draft: CollectionDraft, fields: FieldDraft[]) {
        this.error = '';
        this.message = '';
        try {
            const saved = await this.c.get('cms').saveCollection(definitionOf(draft, fields), this.c.get('principal'));
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

    private check(label: string, checked: boolean, change: (checked: boolean) => void, options: { disabled?: boolean; hint?: string } = {}): TemplateResult {
        return html`<label class=${`flex items-start gap-2 text-sm ${options.disabled ? 'text-muted-foreground' : 'text-foreground cursor-pointer'}`}>
            ${component(Checkbox, { checked, disabled: options.disabled === true, '@change': (event: Event) => change((event.target as HTMLInputElement).checked) })}
            <span>${label}${options.hint ? html`<span class="block text-xs text-muted-foreground">${options.hint}</span>` : null}</span>
        </label>`;
    }

    private fieldEditor(entry: FieldDraft, index: number): TemplateResult {
        const id = (name: string) => `builder-${entry.name}-${name}`;
        const text = (key: 'label' | 'description' | 'max' | 'min' | 'defaultValue', label: string, type: 'text' | 'number' = 'text', hint?: string) => component(Field, { label, for: id(key), ...(hint ? { hint } : {}),
            control: attributes => component(Input, { ...attributes, type, '.value': entry[key], '@input': (event: Event) => this.setField(index, key, (event.target as HTMLInputElement).value) }) });
        const typed = entry.type;
        return html`<div class="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
            ${text('label', __('Label'))}
            ${component(Field, { label: __('Name'), for: id('name'), hint: this.saved.includes(entry.name) ? __('Saved fields keep their name, so stored values stay attached.') : __('Derived from the label.'),
                control: attributes => component(Input, { ...attributes, '.value': entry.name, readonly: true, class: 'font-mono' }) })}
            ${component(Field, { label: __('Type'), for: id('type'), hint: this.saved.includes(entry.name) ? __('Values that do not fit a new type read as empty.') : undefined,
                control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setField(index, 'type', (event.target as HTMLSelectElement).value as FieldType) }, html`
                    ${FIELD_TYPES.map(option => html`<option value=${option.type} ?selected=${option.type === typed}>${option.label}</option>`)}`) })}
            ${component(Field, { label: __('Shown in'), for: id('placement'),
                control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setField(index, 'placement', (event.target as HTMLSelectElement).value as FieldDraft['placement']) }, html`
                    <option value="" ?selected=${!entry.placement}>${__('Default')}</option>
                    <option value="main" ?selected=${entry.placement === 'main'}>${__('Main column')}</option>
                    <option value="sidebar" ?selected=${entry.placement === 'sidebar'}>${__('Sidebar')}</option>`) })}
            <div class="sm:col-span-2">${text('description', __('Help text'))}</div>
            ${['text', 'textarea', 'markdown'].includes(typed) ? text('max', __('Maximum length'), 'number') : null}
            ${['number', 'integer'].includes(typed) ? html`${text('min', __('Minimum'), 'number')}${text('max', __('Maximum'), 'number')}` : null}
            ${['text', 'number', 'integer', 'choice'].includes(typed) ? text('defaultValue', __('Default value')) : null}
            ${typed === 'boolean' ? this.check(__('Checked by default'), entry.defaultValue === 'true', checked => this.setField(index, 'defaultValue', checked ? 'true' : '')) : null}
            ${typed === 'choice' ? html`<div class="sm:col-span-2">${component(Field, { label: __('Choices'), for: id('choices'), hint: __('One per line: letters, digits, dots, hyphens or underscores.'),
                control: attributes => component(Textarea, { ...attributes, rows: 4, '.value': entry.choices, '@input': (event: Event) => this.setField(index, 'choices', (event.target as HTMLTextAreaElement).value) }) })}</div>` : null}
            ${typed === 'reference' ? component(Field, { label: __('Collection'), for: id('target'),
                control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setField(index, 'target', (event.target as HTMLSelectElement).value) }, html`
                    <option value="" ?selected=${!entry.target}>—</option>
                    ${this.targets.map(target => html`<option value=${target.name} ?selected=${target.name === entry.target}>${target.label}</option>`)}`) }) : null}
            ${typed === 'blocks' ? html`<fieldset class="sm:col-span-2 space-y-2">
                <legend class="text-sm font-medium text-foreground">${__('Allowed blocks')}</legend>
                <p class="text-xs text-muted-foreground">${__('None checked allows every block, including plugin blocks.')}</p>
                <div class="grid gap-2 sm:grid-cols-3">${this.blocks.map(block => this.check(block.label, entry.blocks.includes(block.name),
                    checked => this.setField(index, 'blocks', checked ? [...entry.blocks, block.name] : entry.blocks.filter(name => name !== block.name))))}</div>
            </fieldset>` : null}
            <div class="flex flex-wrap gap-4 sm:col-span-2">
                ${this.check(__('Required'), entry.required, checked => this.setField(index, 'required', checked))}
                ${typed === 'text' ? this.check(__('Unique'), entry.unique, checked => this.setField(index, 'unique', checked), { hint: __('No two entries share a value.') }) : null}
                ${['text', 'textarea', 'markdown'].includes(typed) ? this.check(__('Searchable'), entry.search, checked => this.setField(index, 'search', checked)) : null}
            </div>
        </div>`;
    }

    private fieldRow(entry: FieldDraft, index: number, typeLabel: (type: FieldType) => string): TemplateResult {
        const dragging = this.drag?.moved && this.drag.from === index;
        const label = entry.label || entry.name;
        return html`<li class=${`rounded-lg border border-border bg-card transition-opacity ${dragging ? 'opacity-40' : ''}`} data-field=${entry.name}
            ref=${(element: Element) => this.rowRef(entry.key, element)}>
            <div class="flex flex-wrap items-center gap-3 px-2 py-3 sm:px-3">
                <button type="button" class="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing border-none bg-transparent"
                    aria-label=${`${__('Move')} ${label}. ${__('Drag, or use the arrow keys.')}`} aria-describedby="fields-help" data-handle
                    @pointerdown=${(event: PointerEvent) => this.startDrag(event, index)} @pointermove=${(event: PointerEvent) => this.moveDrag(event)}
                    @pointerup=${(event: PointerEvent) => this.endDrag(event)} @pointercancel=${() => this.cancelDrag()} @lostpointercapture=${() => this.cancelDrag()}
                    @keydown=${(event: KeyboardEvent) => this.handleKey(event, index)}>
                    <svg aria-hidden="true" viewBox="0 0 10 16" class="h-4 w-2.5 fill-current"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>
                </button>
                <button type="button" class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left bg-transparent border-none p-0 cursor-pointer" aria-expanded=${this.open[entry.key] ? 'true' : 'false'}
                    ?disabled=${entry.locked} @click=${() => { this.open = { ...this.open, [entry.key]: !this.open[entry.key] }; }}>
                    <span class="font-medium text-foreground">${label}</span>
                    <code class="text-xs text-muted-foreground">${entry.name}</code>
                    ${component(Badge, { variant: 'outline' }, typeLabel(entry.type))}
                    ${entry.required ? component(Badge, { variant: 'secondary' }, __('Required')) : null}
                    ${entry.locked ? component(Badge, { variant: 'secondary' }, __('Built in')) : null}
                </button>
                ${entry.locked ? null : component(Button, { type: 'button', size: 'sm', variant: 'ghost', class: 'text-destructive', '@click': () => this.removeField(index) }, __('Remove'))}
            </div>
            ${this.open[entry.key] && !entry.locked ? this.fieldEditor(entry, index) : null}
        </li>`;
    }

    render() {
        const draft = this.draft;
        if (!draft) return notice(this.error || __('This collection does not exist.'), 'error');
        const typeLabel = (type: FieldType) => FIELD_TYPES.find(option => option.type === type)?.label ?? type;
        const core = [__('Title'), ...(draft.slug ? [__('Slug')] : []), ...(draft.publishable ? [__('Status'), __('Publication time')] : []), ...(draft.hierarchical ? [__('Parent'), __('Order')] : [])];
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
                            <p class="text-sm text-muted-foreground">${__('Every entry has')} ${core.join(', ')}. ${__('Add the fields this collection needs.')}</p>`)}
                        ${component(CardBody, { class: 'space-y-3' }, html`
                            ${this.fields.length ? null : html`<p class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">${__('No fields yet.')}</p>`}
                            ${this.fields.length ? html`<p id="fields-help" class="text-xs text-muted-foreground">${__('Drag the handles to reorder the fields; the editor shows them in this order. On a handle, the arrow keys move the field.')}</p>
                            <div class="relative" ref=${(element: Element) => this.listRef(element)}>
                                <ol class="space-y-3" aria-label=${__('Fields')}>${repeat(this.fields, entry => entry.key, (entry, index) => this.fieldRow(entry, index, typeLabel))}</ol>
                                ${this.drag?.moved ? html`<div aria-hidden="true" class="pointer-events-none absolute inset-x-0 h-1 rounded-full bg-primary" style=${`top: ${this.drag.y}px`}></div>` : null}
                            </div>
                            <p class="sr-only" aria-live="polite">${this.announcement}</p>` : null}
                            <form class="flex flex-wrap items-end gap-2 border-t border-border pt-4" @submit=${(event: Event) => this.addField(event)}>
                                <div class="min-w-[12rem] flex-1">${component(Field, { label: __('New field label'), for: 'new-field-label',
                                    control: attributes => component(Input, { ...attributes, placeholder: __('Such as Price'), '.value': this.adding.label, '@input': (event: Event) => { this.adding = { ...this.adding, label: (event.target as HTMLInputElement).value }; } }) })}</div>
                                <div>${component(Field, { label: __('Type'), for: 'new-field-type',
                                    control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => { this.adding = { ...this.adding, type: (event.target as HTMLSelectElement).value as FieldType }; } }, html`
                                        ${FIELD_TYPES.map(option => html`<option value=${option.type} ?selected=${option.type === this.adding.type} title=${option.description}>${option.label}</option>`)}`) })}</div>
                                ${component(Button, { type: 'submit', variant: 'outline', disabled: !this.adding.label.trim() }, __('Add field'))}
                            </form>`)}
                    `)}
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
