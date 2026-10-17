import { Cossack, Page, State, ClientState, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Button, Card, CardBody, Checkbox, Input, toast } from '@cossackframework/ui';
import { html, component, repeat, type TemplateResult } from '@cossackframework/renderer';
import {
    allowedMoves, buildMenu, dropDepths, flattenMenu, isCmsError, MENU_LIMITS, menuItemId, moveRows, PERMISSIONS, recordTitle, safeLinkUrl, shiftRows, subtreeEnd,
    type MenuMove, type MenuRow, type Principal,
} from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../../cms/guards';
import { box, CONTROL, linkButton, notice, pageHeader } from '../../../../../../cms/ui';

interface SourceEntry { id: string; title: string; depth: number }
interface Source { kind: 'collection' | 'taxonomy'; name: string; label: string; singular: string; archive: boolean; entries: SourceEntry[] }
/** What an item points at, for its row: the entry's or term's current title and where to edit it. */
interface Target { title: string; type: string; draft: boolean; missing: boolean; edit: string | null }
interface LocationChoice { name: string; label: string; theme: string; active: boolean; checked: boolean }
interface Drag { from: number; to: number; depth: number; valid: boolean; y: number; moved: boolean }

/** Pixels of horizontal drag per nesting level, and the indent of each level in the list. */
const INDENT = 32;
const MOVE_LABELS: Record<MenuMove, string> = { up: 'Move up', down: 'Move down', in: 'Move under the item above', out: 'Move out one level' };

/** Item titles and types, read as the editor so drafts show too. */
async function describe(cms: CmsHost, rows: readonly MenuRow[], principal: Principal): Promise<Record<string, Target>> {
    const targets: Record<string, Target> = {};
    const entries = new Map<string, string[]>();
    for (const row of rows) if (row.kind === 'entry' && row.collection && row.entry) entries.set(row.collection, [...(entries.get(row.collection) ?? []), row.entry]);
    const found = new Map<string, { title: string; draft: boolean }>();
    for (const [name, ids] of entries) {
        try {
            const collection = cms.collection(name);
            for (const record of (await cms.resource(`cms/${name}`).getMany(ids, { principal })).values()) {
                found.set(`${name}:${record.id}`, { title: recordTitle(record, 'title'), draft: collection.publishable !== false && record.status !== 'published' });
            }
        } catch (error) { if (!isCmsError(error)) throw error; }
    }
    const terms = await cms.taxonomies.getMany(rows.filter(row => row.kind === 'term' && row.term).map(row => row.term!));
    for (const row of rows) {
        if (row.kind === 'link') { targets[row.id] = { title: row.url ?? '', type: __('Custom link'), draft: false, missing: false, edit: null }; continue; }
        if (row.kind === 'archive') {
            const collection = cms.collections().find(entry => entry.name === row.collection);
            targets[row.id] = { title: collection?.label ?? row.collection ?? '', type: __('Archive'), draft: false, missing: !collection?.path, edit: null };
            continue;
        }
        if (row.kind === 'entry') {
            const entry = found.get(`${row.collection}:${row.entry}`);
            const collection = cms.collections().find(item => item.name === row.collection);
            targets[row.id] = { title: entry?.title ?? __('Deleted entry'), type: collection?.singular ?? row.collection ?? '', draft: entry?.draft ?? false, missing: !entry, edit: entry ? `/dashboard/content/${row.collection}/${row.entry}` : null };
            continue;
        }
        const term = terms.get(row.term ?? '');
        const taxonomy = cms.taxonomies.declarations.find(item => item.name === row.taxonomy);
        targets[row.id] = { title: term?.name ?? __('Deleted term'), type: taxonomy?.singular ?? row.taxonomy ?? '', draft: false, missing: !term, edit: term ? `/dashboard/terms/${term.taxonomy}/${term.id}` : null };
    }
    return targets;
}

/** Collections and taxonomies with public URLs, each with recent entries or its terms. */
async function sources(cms: CmsHost, principal: Principal): Promise<Source[]> {
    const list: Source[] = [];
    for (const collection of cms.collections()) {
        if (collection.path === null || collection.path === undefined || collection.slug === false) continue;
        const publishable = collection.publishable !== false;
        const page = await cms.resource(`cms/${collection.name}`).list({
            ...(publishable ? { where: { status: 'published' } } : {}), limit: 30,
            order: collection.hierarchical || !publishable ? { field: 'title', direction: 'asc' } : { field: 'publishedAt', direction: 'desc' },
        }, { principal }).catch(() => ({ records: [] }));
        list.push({ kind: 'collection', name: collection.name, label: collection.label, singular: collection.singular, archive: collection.path !== '',
            entries: page.records.map(record => ({ id: record.id, title: recordTitle(record, 'title'), depth: 0 })) });
    }
    for (const taxonomy of cms.taxonomies.declarations) {
        if (!taxonomy.path) continue;
        const terms = (await cms.taxonomies.tree(taxonomy.name)).slice(0, 100);
        list.push({ kind: 'taxonomy', name: taxonomy.name, label: taxonomy.label, singular: taxonomy.singular, archive: false, entries: terms.map(term => ({ id: term.id, title: term.name, depth: term.depth })) });
    }
    return list;
}

/**
 * The menu editor, laid out like WordPress: item sources on the left, the menu's structure on
 * the right. Drag an item by its handle (mouse, touch or pen); dragging sideways nests it. The
 * arrow keys on a handle and the buttons in each item move it too.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageAppearance)] })
export default class MenuEditor extends Cossack {
    @State() id = '';
    @State() name = '';
    @State() revision = 0;
    @State() rows: MenuRow[] = [];
    @State() targets: Record<string, Target> = {};
    @State() sources: Source[] = [];
    @State() locations: LocationChoice[] = [];
    @State() error = '';
    @State() conflict = false;
    @ClientState() selected: Record<string, string[]> = {};
    @ClientState() link = { url: '', label: '' };
    @ClientState() linkError = '';
    @ClientState() open: string[] = [];
    @ClientState() drag: Drag | null = null;
    @ClientState() announcement = '';
    @ClientState() dirty = false;
    @ClientState() saving = false;
    @ClientState() confirmDelete = false;
    private rowElements = new Map<string, HTMLElement>();
    private handles = new Map<string, HTMLElement>();
    private list?: HTMLElement;
    private pointer: { id: number; x: number; y: number; depth: number; tops: number[]; bottoms: number[] } | null = null;

    head(): HeadValue {
        return { title: this.name ? `${__('Edit menu')}: ${this.name}` : __('Edit menu') };
    }

    async init() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const menu = await cms.menus.get(this.c.req.param('id') ?? '');
        if (!menu) { this.error = __('This menu does not exist.'); this.c.status(404); return; }
        this.id = menu.id;
        this.name = menu.name;
        this.revision = menu.revision;
        this.rows = flattenMenu(menu.items);
        this.targets = await describe(cms, this.rows, principal);
        this.sources = await sources(cms, principal);
        const assigned = await cms.menus.locations();
        this.locations = (await cms.menuLocations()).map(location => ({ ...location, checked: assigned.get(location.name) === menu.id }));
        this.message(this.c.req.query('saved') === '1' ? __('Menu saved.') : '');
    }

    private message(text: string) {
        if (text) this.announcement = text;
    }

    // --- Adding items ------------------------------------------------------------

    @Client()
    toggleSelected(source: string, id: string, checked: boolean) {
        const current = this.selected[source] ?? [];
        this.selected = { ...this.selected, [source]: checked ? [...current, id] : current.filter(entry => entry !== id) };
    }

    @Client()
    addSelected(source: Source) {
        const chosen = this.selected[source.name] ?? [];
        if (!chosen.length) return;
        const added: MenuRow[] = [];
        const targets = { ...this.targets };
        for (const value of chosen) {
            const id = menuItemId();
            if (value === '__archive') {
                added.push({ id, kind: 'archive', label: '', collection: source.name, depth: 0 });
                targets[id] = { title: source.label, type: __('Archive'), draft: false, missing: false, edit: null };
                continue;
            }
            const entry = source.entries.find(item => item.id === value);
            if (!entry) continue;
            added.push(source.kind === 'collection' ? { id, kind: 'entry', label: '', collection: source.name, entry: entry.id, depth: 0 } : { id, kind: 'term', label: '', taxonomy: source.name, term: entry.id, depth: 0 });
            targets[id] = { title: entry.title, type: source.singular, draft: false, missing: false, edit: source.kind === 'collection' ? `/dashboard/content/${source.name}/${entry.id}` : `/dashboard/terms/${source.name}/${entry.id}` };
        }
        if (this.rows.length + added.length > MENU_LIMITS.items) { toast.error(`${__('A menu holds at most')} ${MENU_LIMITS.items} ${__('items.')}`); return; }
        this.targets = targets;
        this.rows = [...this.rows, ...added];
        this.selected = { ...this.selected, [source.name]: [] };
        this.changed(`${added.length} ${added.length === 1 ? __('item added to the menu.') : __('items added to the menu.')}`);
    }

    @Client()
    addLink(event: Event) {
        event.preventDefault();
        const raw = this.link.url.trim();
        const url = /^[a-z][a-z0-9+.-]*:|^[/#]/i.test(raw) ? raw : `https://${raw}`;
        if (!raw || !safeLinkUrl(url)) { this.linkError = __('Enter a URL such as https://example.com, /about or #contact.'); return; }
        if (!this.link.label.trim()) { this.linkError = __('Enter the link text.'); return; }
        const id = menuItemId();
        this.targets = { ...this.targets, [id]: { title: url, type: __('Custom link'), draft: false, missing: false, edit: null } };
        this.rows = [...this.rows, { id, kind: 'link', label: this.link.label.trim(), url, depth: 0 }];
        this.link = { url: '', label: '' };
        this.linkError = '';
        this.changed(__('Link added to the menu.'));
    }

    @Server()
    async findEntries(source: string, query: string) {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const entry = this.sources.find(item => item.name === source);
        if (!entry) return;
        let entries: SourceEntry[];
        if (entry.kind === 'taxonomy') {
            entries = query.trim() ? (await cms.taxonomies.list(source, { search: query, limit: 50 })).items.map(term => ({ id: term.id, title: term.name, depth: 0 }))
                : (await cms.taxonomies.tree(source)).slice(0, 100).map(term => ({ id: term.id, title: term.name, depth: term.depth }));
        } else {
            const collection = cms.collection(source);
            const where = collection.publishable === false ? {} : { where: { status: 'published' } };
            const records = query.trim() ? await cms.resource(`cms/${source}`).search(query.slice(0, 100), { limit: 30, ...where }, { principal }).catch(() => [])
                : (await cms.resource(`cms/${source}`).list({ ...where, limit: 30 }, { principal })).records;
            entries = records.map(record => ({ id: record.id, title: recordTitle(record, 'title'), depth: 0 }));
        }
        this.sources = this.sources.map(item => item.name === source ? { ...item, entries } : item);
    }

    // --- Editing items -----------------------------------------------------------

    @Client()
    changed(announcement: string) {
        this.dirty = true;
        this.announcement = announcement;
    }

    @Client()
    toggle(id: string) {
        this.open = this.open.includes(id) ? this.open.filter(entry => entry !== id) : [...this.open, id];
    }

    @Client()
    setRow(index: number, patch: Partial<MenuRow>) {
        this.rows = this.rows.map((row, position) => position === index ? { ...row, ...patch } : row);
        this.dirty = true;
    }

    /** Remove an item; its children move up a level, as in WordPress. */
    @Client()
    removeRow(index: number) {
        const row = this.rows[index];
        if (!row) return;
        const end = subtreeEnd(this.rows, index);
        this.rows = [...this.rows.slice(0, index), ...this.rows.slice(index + 1, end).map(entry => ({ ...entry, depth: entry.depth - 1 })), ...this.rows.slice(end)];
        this.changed(`${this.labelOf(row)} ${__('removed.')}`);
    }

    @Client()
    shift(index: number, move: MenuMove) {
        const row = this.rows[index];
        const next = shiftRows(this.rows, index, move);
        if (!row || next === this.rows) return;
        this.rows = [...next];
        this.changed(`${this.labelOf(row)}: ${this.position(row.id)}`);
        requestAnimationFrame(() => this.handles.get(row.id)?.focus());
    }

    labelOf(row: MenuRow): string {
        return row.label || this.targets[row.id]?.title || __('Item');
    }

    /** Where an item now sits, for screen readers: its parent and its place among siblings. */
    position(id: string): string {
        const index = this.rows.findIndex(row => row.id === id);
        const row = this.rows[index]!;
        let parent = index - 1;
        while (parent >= 0 && this.rows[parent]!.depth >= row.depth) parent--;
        const siblings = this.rows.filter((entry, position) => entry.depth === row.depth && position > parent && (parent < 0 || position < subtreeEnd(this.rows, parent)));
        const place = `${__('item')} ${siblings.findIndex(entry => entry.id === id) + 1} ${__('of')} ${siblings.length}`;
        return parent >= 0 ? `${place} ${__('under')} ${this.labelOf(this.rows[parent]!)}` : `${place} ${__('at the top level')}`;
    }

    // --- Dragging ----------------------------------------------------------------

    @Client()
    rowRef(id: string, element: Element | undefined) {
        if (element) this.rowElements.set(id, element as HTMLElement); else this.rowElements.delete(id);
    }

    @Client()
    handleRef(id: string, element: Element | undefined) {
        if (element) this.handles.set(id, element as HTMLElement); else this.handles.delete(id);
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
        const rects = this.rows.map(row => this.rowElements.get(row.id)?.getBoundingClientRect());
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, depth: this.rows[index]!.depth,
            tops: rects.map(rect => (rect?.top ?? 0) - top), bottoms: rects.map(rect => (rect?.bottom ?? 0) - top) };
        this.drag = { from: index, to: index, depth: this.rows[index]!.depth, valid: false, y: 0, moved: false };
    }

    @Client()
    moveDrag(event: PointerEvent) {
        const pointer = this.pointer;
        const drag = this.drag;
        if (!pointer || !drag || event.pointerId !== pointer.id || !this.list) return;
        if (!drag.moved && Math.abs(event.clientY - pointer.y) < 4 && Math.abs(event.clientX - pointer.x) < 4) return;
        const y = event.clientY - this.list.getBoundingClientRect().top;
        const end = subtreeEnd(this.rows, drag.from);
        const rest = this.rows.map((_, index) => index).filter(index => index < drag.from || index >= end);
        let to = 0;
        while (to < rest.length && (pointer.tops[rest[to]!]! + pointer.bottoms[rest[to]!]!) / 2 < y) to++;
        const { min, max } = dropDepths(this.rows, drag.from, to);
        const depth = Math.min(Math.max(pointer.depth + Math.round((event.clientX - pointer.x) / INDENT), min), Math.max(max, min));
        const line = to < rest.length ? pointer.tops[rest[to]!]! : pointer.bottoms[rest.at(-1) ?? 0] ?? 0;
        if (drag.to !== to || drag.depth !== depth || !drag.moved) this.drag = { ...drag, to, depth, valid: max >= min, y: line - 2, moved: true };
        // Scroll while dragging near the window's edges.
        if (event.clientY < 60) window.scrollBy(0, -12);
        else if (event.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    }

    @Client()
    endDrag(event: PointerEvent) {
        const drag = this.drag;
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        this.pointer = null;
        this.drag = null;
        if (!drag?.moved || !drag.valid) return;
        const row = this.rows[drag.from]!;
        const next = moveRows(this.rows, drag.from, drag.to, drag.depth);
        if (next.every((entry, index) => entry.id === this.rows[index]?.id && entry.depth === this.rows[index]?.depth)) return;
        this.rows = next;
        this.changed(`${this.labelOf(row)}: ${this.position(row.id)}`);
    }

    @Client()
    cancelDrag() {
        this.pointer = null;
        this.drag = null;
    }

    @Client()
    handleKey(event: KeyboardEvent, index: number) {
        const moves: Record<string, MenuMove> = { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'in', ArrowLeft: 'out' };
        if (event.key === 'Escape' && this.drag) { this.cancelDrag(); return; }
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        this.shift(index, move);
    }

    // --- Saving ------------------------------------------------------------------

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        this.saving = true;
        try { await this.save(this.name, this.rows, this.revision, this.locations.filter(location => location.checked).map(location => location.name)); }
        finally { this.saving = false; }
        if (this.error) toast.error(this.error);
        else { this.dirty = false; toast.success(__('Menu saved.')); }
    }

    @Server()
    async save(name: string, rows: MenuRow[], revision: number, locations: string[]) {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        this.error = '';
        this.conflict = false;
        try {
            const menu = await cms.menus.update(this.c.req.param('id') ?? '', { name, items: buildMenu(rows) }, { principal, expectedRevision: revision });
            await cms.menus.place(menu.id, locations, { principal, known: (await cms.menuLocations()).map(location => location.name) });
            this.name = menu.name;
            this.revision = menu.revision;
            this.rows = flattenMenu(menu.items);
            this.targets = await describe(cms, this.rows, principal);
        } catch (error) {
            this.conflict = isCmsError(error, 'CMS_CONFLICT') && !(isCmsError(error) && error.fields?.name);
            this.error = isCmsError(error) ? error.message : __('The menu could not be saved.');
        }
    }

    @Server()
    async deleteMenu() {
        try {
            await this.c.get('cms').menus.delete(this.c.req.param('id') ?? '', { principal: this.c.get('principal') });
            return this.redirect('/dashboard/appearance/menus');
        } catch (error) { this.error = isCmsError(error) ? error.message : __('The menu could not be deleted.'); }
    }

    // --- Rendering ---------------------------------------------------------------

    private sourceBox(source: Source): TemplateResult {
        const selected = this.selected[source.name] ?? [];
        const option = (value: string, label: string, depth = 0) => html`<label class="flex items-center gap-2 py-0.5 text-sm text-foreground cursor-pointer" style=${`padding-left: ${depth * 1.25}rem`}>
            ${component(Checkbox, { checked: selected.includes(value), '@change': (event: Event) => this.toggleSelected(source.name, value, (event.target as HTMLInputElement).checked) })} ${label}</label>`;
        return html`<details class="rounded-lg border border-border bg-card" ?open=${source.name === this.sources[0]?.name}>
            <summary class="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-foreground">${source.label}</summary>
            <div class="space-y-3 border-t border-border p-4">
                <input type="search" class=${CONTROL} placeholder=${`${__('Search')} ${source.label.toLowerCase()}`} aria-label=${`${__('Search')} ${source.label.toLowerCase()}`}
                    @change=${(event: Event) => this.findEntries(source.name, (event.target as HTMLInputElement).value)}>
                <div class="max-h-56 overflow-y-auto">
                    ${source.archive ? option('__archive', `${__('All')} ${source.label.toLowerCase()} (${__('archive')})`) : null}
                    ${source.entries.length ? source.entries.map(entry => option(entry.id, entry.title, entry.depth)) : html`<p class="text-xs text-muted-foreground">${__('Nothing found.')}</p>`}
                </div>
                ${component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !selected.length, '@click': () => this.addSelected(source) }, __('Add to menu'))}
            </div>
        </details>`;
    }

    private linkBox(): TemplateResult {
        return html`<details class="rounded-lg border border-border bg-card">
            <summary class="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-foreground">${__('Custom links')}</summary>
            <form class="space-y-3 border-t border-border p-4" @submit=${(event: Event) => this.addLink(event)}>
                <div class="space-y-1"><label for="link-url" class="block text-xs font-medium text-foreground">${__('URL')}</label>
                    <input id="link-url" type="text" inputmode="url" class=${CONTROL} placeholder="https://" .value=${this.link.url} @input=${(event: Event) => { this.link = { ...this.link, url: (event.target as HTMLInputElement).value }; }}></div>
                <div class="space-y-1"><label for="link-label" class="block text-xs font-medium text-foreground">${__('Link text')}</label>
                    <input id="link-label" type="text" class=${CONTROL} .value=${this.link.label} @input=${(event: Event) => { this.link = { ...this.link, label: (event.target as HTMLInputElement).value }; }}></div>
                ${this.linkError ? html`<p role="alert" class="text-xs text-destructive">${this.linkError}</p>` : null}
                ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Add to menu'))}
            </form>
        </details>`;
    }

    private row(row: MenuRow, index: number): TemplateResult {
        const target = this.targets[row.id];
        const open = this.open.includes(row.id);
        const drag = this.drag;
        const dragging = drag?.moved && index >= drag.from && index < subtreeEnd(this.rows, drag.from);
        const moves = allowedMoves(this.rows, index);
        const label = this.labelOf(row);
        return html`<li class=${`transition-opacity ${dragging ? 'opacity-40' : ''}`} style=${`margin-left: ${row.depth * INDENT}px`} data-menu-item=${row.id} data-depth=${row.depth}
            ref=${(element: Element) => this.rowRef(row.id, element)}>
            <div class=${`flex items-center gap-2 rounded-md border bg-card px-2 py-2 ${target?.missing ? 'border-destructive/60' : 'border-border'}`}>
                <button type="button" class="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing border-none bg-transparent"
                    aria-label=${`${__('Move')} ${label}. ${__('Drag, or use the arrow keys.')}`} aria-describedby="menu-help" data-handle
                    ref=${(element: Element) => this.handleRef(row.id, element)}
                    @pointerdown=${(event: PointerEvent) => this.startDrag(event, index)} @pointermove=${(event: PointerEvent) => this.moveDrag(event)}
                    @pointerup=${(event: PointerEvent) => this.endDrag(event)} @pointercancel=${() => this.cancelDrag()} @lostpointercapture=${() => this.cancelDrag()}
                    @keydown=${(event: KeyboardEvent) => this.handleKey(event, index)}>
                    <svg aria-hidden="true" viewBox="0 0 10 16" class="h-4 w-2.5 fill-current"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>
                </button>
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">${label}</span>
                <span class="hidden shrink-0 text-xs text-muted-foreground sm:inline">${target?.type ?? ''}${target?.draft ? ` · ${__('Draft')}` : ''}${target?.missing ? ` · ${__('Missing')}` : ''}</span>
                <button type="button" class="shrink-0 rounded px-2 py-1 text-xs text-primary hover:underline border-none bg-transparent cursor-pointer" aria-expanded=${open ? 'true' : 'false'}
                    aria-controls=${`item-${row.id}`} @click=${() => this.toggle(row.id)}>${open ? __('Close') : __('Edit')}<span class="sr-only"> ${label}</span></button>
            </div>
            ${open ? html`<div id=${`item-${row.id}`} class="mt-1 space-y-3 rounded-md border border-border bg-muted/30 p-3">
                <div class="grid gap-3 sm:grid-cols-2">
                    <div class="space-y-1"><label for=${`label-${row.id}`} class="block text-xs font-medium text-foreground">${__('Navigation label')}</label>
                        <input id=${`label-${row.id}`} class=${CONTROL} maxlength=${MENU_LIMITS.label} .value=${row.label} placeholder=${target?.title ?? ''}
                            @input=${(event: Event) => this.setRow(index, { label: (event.target as HTMLInputElement).value })}></div>
                    ${row.kind === 'link' ? html`<div class="space-y-1"><label for=${`url-${row.id}`} class="block text-xs font-medium text-foreground">${__('URL')}</label>
                        <input id=${`url-${row.id}`} class=${CONTROL} .value=${row.url ?? ''} @input=${(event: Event) => this.setRow(index, { url: (event.target as HTMLInputElement).value.trim() })}></div>` : null}
                </div>
                <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    ${component(Checkbox, { checked: row.newTab === true, '@change': (event: Event) => this.setRow(index, { newTab: (event.target as HTMLInputElement).checked })})} ${__('Open link in a new tab')}</label>
                ${row.kind !== 'link' && target ? html`<p class="text-xs text-muted-foreground">${__('Original')}: ${target.edit ? html`<a href=${target.edit} class="text-primary hover:underline">${target.title}</a>` : target.title}</p>` : null}
                <div class="flex flex-wrap items-center gap-2 text-xs">
                    <span class="text-muted-foreground">${__('Move')}:</span>
                    ${(['up', 'down', 'in', 'out'] as const).map(move => html`<button type="button" ?disabled=${!moves.has(move)} @click=${() => this.shift(index, move)}
                        class="rounded border border-border bg-background px-2 py-1 text-foreground hover:bg-muted cursor-pointer disabled:cursor-default disabled:opacity-40">${__(MOVE_LABELS[move])}</button>`)}
                    <button type="button" class="ml-auto text-destructive hover:underline border-none bg-transparent p-0 cursor-pointer" @click=${() => this.removeRow(index)}>${__('Remove')}</button>
                </div>
            </div>` : null}
        </li>`;
    }

    render() {
        if (!this.id) return html`<div class="space-y-4">${notice(this.error || __('This menu does not exist.'), 'error')}${linkButton(__('All menus'), '/dashboard/appearance/menus', 'outline')}</div>`;
        const drag = this.drag;
        return html`<div class="space-y-6">
            ${pageHeader(__('Edit menu'), { actions: html`<a href="/dashboard/appearance/menus" class="text-sm text-muted-foreground hover:text-foreground">← ${__('All menus')}</a>` })}
            ${this.error ? html`<div class="space-y-2">${notice(this.error, 'error')}${this.conflict ? html`<a href=${`/dashboard/appearance/menus/${this.id}`} class="text-sm text-primary hover:underline">${__('Reload the menu')}</a>` : null}</div>` : null}
            <div class="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
                <aside class="space-y-3" aria-label=${__('Add menu items')}>
                    <h2 class="text-sm font-semibold text-foreground">${__('Add menu items')}</h2>
                    ${this.sources.map(source => this.sourceBox(source))}
                    ${this.linkBox()}
                </aside>
                <form class="min-w-0" @submit=${(event: Event) => this.submit(event)}>
                    ${component(Card, {}, component(CardBody, { class: 'space-y-5' }, html`
                        <div class="flex flex-wrap items-end gap-3">
                            <div class="min-w-48 flex-1 space-y-1"><label for="menu-name" class="block text-sm font-medium text-foreground">${__('Menu name')}</label>
                                ${component(Input, { id: 'menu-name', '.value': this.name, maxlength: MENU_LIMITS.name, '@input': (event: Event) => { this.name = (event.target as HTMLInputElement).value; this.dirty = true; } })}</div>
                            ${component(Button, { type: 'submit', disabled: this.saving || !this.name.trim() }, this.saving ? __('Saving…') : __('Save menu'))}
                        </div>
                        <div class="space-y-2">
                            <h2 class="text-sm font-semibold text-foreground">${__('Menu structure')}</h2>
                            <p id="menu-help" class="text-xs text-muted-foreground">${__('Drag the handles to reorder; drag right to nest an item under the one above. On a handle, the arrow keys move the item.')}</p>
                            ${this.rows.length ? html`<div class="relative" ref=${(element: Element) => this.listRef(element)}>
                                <ol class="space-y-1.5" aria-label=${__('Menu structure')}>${repeat(this.rows, row => row.id, (row, index) => this.row(row, index))}</ol>
                                ${drag?.moved ? html`<div aria-hidden="true" class=${`pointer-events-none absolute right-0 h-1 rounded-full ${drag.valid ? 'bg-primary' : 'bg-destructive'}`}
                                    style=${`top: ${drag.y}px; left: ${drag.depth * INDENT}px`}></div>` : null}
                            </div>` : html`<p class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">${__('Add items from the column on the left.')}</p>`}
                            <p class="sr-only" aria-live="polite">${this.announcement}</p>
                        </div>
                        ${box(__('Display location'), this.locations.length ? html`<div class="space-y-1.5">${this.locations.map((location, index) => html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                            ${component(Checkbox, { checked: location.checked, '@change': (event: Event) => { this.locations = this.locations.map((entry, position) => position === index ? { ...entry, checked: (event.target as HTMLInputElement).checked } : entry); this.dirty = true; } })}
                            ${location.label}${location.active ? null : html`<span class="text-xs text-muted-foreground">(${location.theme})</span>`}</label>`)}</div>`
                            : html`<p class="text-sm text-muted-foreground">${__('The active theme has no menu locations.')}</p>`)}
                        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                            <button type="button" class="text-sm text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => { this.confirmDelete = true; }}>${__('Delete menu')}</button>
                            <span class="flex items-center gap-3">
                                ${this.dirty ? html`<span class="text-xs text-muted-foreground">${__('Unsaved changes')}</span>` : null}
                                ${component(Button, { type: 'submit', disabled: this.saving || !this.name.trim() }, this.saving ? __('Saving…') : __('Save menu'))}
                            </span>
                        </div>`))}
                </form>
            </div>
            ${component(AlertDialog, {
                id: 'delete-menu-dialog', open: this.confirmDelete, title: __('Delete menu?'),
                description: `“${this.name}” ${__('and its items are deleted. Locations that showed it fall back to the theme default.')}`,
                cancelLabel: __('Cancel'), actionLabel: __('Delete'), actionVariant: 'destructive',
                onAction: () => { this.confirmDelete = false; void this.deleteMenu(); },
                onOpenChange: () => { this.confirmDelete = false; },
            })}
        </div>`;
    }
}
