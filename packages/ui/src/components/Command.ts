import { html, classMap, live, repeat, ifDefined } from '@cossackframework/renderer';
import { Cossack, Component, Client, ClientState } from '@cossackframework/core';
import { DialogController, type DialogControlProps } from '../internal/dialog';
import { ControlledValue } from '../native-attributes';

const shortcutOwners = new WeakMap<Document, Map<HTMLDialogElement, Command>>();

export type CommandItem = { readonly id: string; readonly label: string; readonly group?: string; readonly disabled?: boolean; readonly description?: string };
export type CommandProps = Omit<DialogControlProps, 'id' | 'aria-label' | 'aria-labelledby' | 'onOpenChange'> & {
    id: string;
    /** Accessible name of the modal palette. */
    label: string;
    items?: readonly CommandItem[];
    onSelect?: (id: string) => unknown;
    onOpenChange?: (open: boolean) => unknown;
    /** Opt in to Ctrl/Meta+K. The first eligible owner in document order handles the event. */
    shortcut?: boolean;
    /** Allow the global shortcut in unrelated editable controls. Default false. */
    shortcutInEditable?: boolean;
    /** Group matching items by first group appearance; keyboard order follows visible order. */
    grouped?: boolean;
    /** Presentational item content only. The item label still owns search and accessible naming. */
    renderItem?: (item: Readonly<CommandItem>) => unknown;
    placeholder?: string;
    searchLabel?: string;
    emptyLabel?: string;
    closeLabel?: string;
};

/** Modal command search with application-owned selection and optional global shortcut. */
@Component()
export class Command extends Cossack {
    declare props: CommandProps;
    @ClientState() private localOpened: boolean | undefined;
    @ClientState() private searchText = '';
    @ClientState() private activeId: string | undefined;
    private initialOpened?: boolean;
    private previousOpened?: boolean;
    private element?: HTMLDialogElement;
    private removeShortcut?: () => void;
    private generation = 0;
    private controlled = new ControlledValue<boolean>();
    private dialog = new DialogController(() => ({ ...this.props, open: this.isOpen, onOpenChange: () => this.setOpen(false) }), () => this.requestUpdate());

    get isOpen() { return this.props.open ?? this.localOpened ?? this.initialOpened ?? !!this.props.defaultOpen; }
    getFiltered() {
        const query = this.searchText.trim().toLowerCase();
        const items = (this.props.items ?? []).filter(item => item.label.toLowerCase().includes(query));
        return this.props.grouped ? this.groups(items).flatMap(group => group.items) : items;
    }
    private groups(items: readonly CommandItem[]) {
        const groups = new Map<string, CommandItem[]>();
        for (const item of items) {
            const name = item.group?.trim() ?? '';
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name)!.push(item);
        }
        return Array.from(groups, ([name, items]) => ({ name, items }));
    }
    private active(items = this.getFiltered()) { return items.find(item => item.id === this.activeId && !item.disabled) ?? items.find(item => !item.disabled); }
    private optionId(id: string) { return `${this.props.id}-option-${encodeURIComponent(id)}`; }
    private connect(element: HTMLDialogElement) {
        this.dialog.connect(element);
        const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || !element.isConnected) return;
            if (this.element !== element) {
                this.removeShortcut?.(); this.element = element;
                const document = element.ownerDocument;
                let owners = shortcutOwners.get(document);
                if (!owners) { owners = new Map(); shortcutOwners.set(document, owners); }
                owners.set(element, this);
                const shortcut = (event: KeyboardEvent) => {
                    if (!this.props.shortcut || event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
                    const modal = document.activeElement?.closest('dialog:modal') ?? document.querySelector(':modal');
                    const target = event.composedPath().find(node => node instanceof HTMLElement) as HTMLElement | undefined;
                    const editable = !!target && (target.isContentEditable || !!target.closest('input, textarea, select'));
                    const eligible = Array.from(owners!.entries()).filter(([dialog, owner]) => dialog.isConnected && owner.props.shortcut
                        && (!modal || modal === dialog) && (!editable || owner.isOpen || owner.props.shortcutInEditable));
                    eligible.sort(([left], [right]) => left === right ? 0 : left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
                    if (eligible[0]?.[0] !== element) return;
                    event.preventDefault(); this.setOpen(!this.controlled.base(this.props, this.isOpen));
                };
                document.addEventListener('keydown', shortcut);
                this.removeShortcut = () => { document.removeEventListener('keydown', shortcut); owners!.delete(element); };
            }
            const active = this.active();
            if (active && element.open) element.ownerDocument.getElementById(this.optionId(active.id))?.scrollIntoView({ block: 'nearest' });
        });
    }
    /** Proposes a change. It builds on a proposal the parent has not rendered yet. */
    @Client() setOpen(open: boolean) {
        if (!this.controlled.changed(this.props, this.isOpen, open)) return;
        if (this.props.open === undefined) this.localOpened = open;
        this.props.onOpenChange?.(this.controlled.emit(this.props, open));
        void this.requestUpdate();
    }
    @Client() private selectItem(id: string) {
        if (!this.getFiltered().some(item => item.id === id && !item.disabled)) return;
        this.props.onSelect?.(id);
        this.setOpen(false);
    }
    @Client() private keydown(event: KeyboardEvent) {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
        const items = this.getFiltered().filter(item => !item.disabled), active = this.active(items);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!items.length) return;
            const index = items.findIndex(item => item.id === active?.id);
            this.activeId = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].id;
        } else if (event.key === 'Enter' && active) { event.preventDefault(); this.selectItem(active.id); }
    }
    render() {
        const { id, label, items = [], onSelect: _select, onOpenChange: _change, shortcut: _shortcut, shortcutInEditable: _editable, grouped = false, renderItem,
            open: _open, defaultOpen: _default, closeOnEscape: _escape, closeOnBackdrop: _backdrop,
            placeholder = 'Search...', searchLabel = 'Search commands', emptyLabel = 'No results found.', closeLabel = 'Close commands', ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('Command requires a nonempty, whitespace-free id.');
        for (const [name,value] of [['label',label],['searchLabel',searchLabel],['emptyLabel',emptyLabel],['closeLabel',closeLabel]]) {
            if (typeof value !== 'string' || !value.trim()) throw new Error(`Command requires a nonempty ${name}.`);
        }
        const ids = new Set<string>();
        for (const item of items) {
            if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim()) throw new Error('Command items require unique nonempty IDs and labels.');
            if ((item.group !== undefined && typeof item.group !== 'string') || (item.description !== undefined && typeof item.description !== 'string')) throw new Error('Command group and description must be text.');
            ids.add(item.id);
        }
        this.initialOpened ??= !!this.props.defaultOpen;
        if (this.previousOpened !== this.isOpen) { this.searchText = ''; this.activeId = undefined; this.previousOpened = this.isOpen; }
        const filtered = this.getFiltered(), active = this.active(filtered);
        const option = (item: CommandItem) => html`<div id=${this.optionId(item.id)} role="option" aria-label=${item.label} aria-description=${ifDefined(item.description)} aria-selected=${item.id === active?.id} aria-disabled=${!!item.disabled}
            class=${classMap({ 'cs-command__item flex items-center gap-2 px-3 py-2 text-sm rounded-md': true, 'bg-accent text-accent-foreground': item.id === active?.id, 'opacity-50 cursor-not-allowed': !!item.disabled, 'cursor-pointer': !item.disabled })}
            @pointerdown=${(event: PointerEvent) => event.preventDefault()}
            @pointermove=${() => { if (!item.disabled) this.activeId = item.id; }} @click=${() => this.selectItem(item.id)}>
            ${!grouped && item.group ? html`<span class="text-xs text-muted-foreground mr-2">${item.group}</span>` : null}${renderItem ? renderItem(item) : item.label}
        </div>`;
        return html`<dialog ref=${(element: Element) => this.connect(element as HTMLDialogElement)} id=${id} aria-label=${label}
            class="cs-command m-auto p-0 w-full max-w-xl max-h-[calc(100dvh-2rem)] bg-popover text-popover-foreground rounded-lg border shadow-xl overflow-auto"
            ...=${{ ...rest, ...this.dialog.events() }}>
            <div data-dialog-panel class="cs-command__panel">
                <div class="flex items-center border-b">
                    <input id=${`${id}-search`} class="cs-command__input min-w-0 flex-1 px-4 py-3 text-sm bg-transparent outline-none"
                        type="text" role="combobox" aria-label=${searchLabel} aria-autocomplete="list" aria-haspopup="listbox"
                        aria-expanded=${this.isOpen} aria-controls=${`${id}-list`} aria-activedescendant=${active ? this.optionId(active.id) : undefined}
                        autocomplete="off" placeholder=${placeholder} .value=${live(this.searchText)} autofocus
                        @input=${(event: Event) => { this.searchText = (event.target as HTMLInputElement).value; this.activeId = undefined; }}
                        @keydown=${(event: KeyboardEvent) => this.keydown(event)}>
                    <button type="button" class="px-3 py-2" aria-label=${closeLabel} @click=${() => this.setOpen(false)}>×</button>
                </div>
                <div id=${`${id}-list`} role="listbox" aria-label=${label} class="cs-command__list max-h-[300px] overflow-y-auto p-2">
                    ${grouped ? repeat(this.groups(filtered), group => group.name, group => html`<div role=${ifDefined(group.name ? 'group' : undefined)} aria-label=${ifDefined(group.name || undefined)}>
                        ${group.name ? html`<div aria-hidden="true" class="px-3 py-1 text-xs text-muted-foreground">${group.name}</div>` : null}
                        ${repeat(group.items, item => item.id, option)}
                    </div>`) : repeat(filtered, item => item.id, option)}
                </div>
                ${filtered.length ? null : html`<p role="status" class="px-3 py-6 text-center text-sm text-muted-foreground">${emptyLabel}</p>`}
            </div>
        </dialog>`;
    }
    onCleanup() { this.generation++; this.removeShortcut?.(); this.removeShortcut = undefined; this.element = undefined; this.dialog.disconnect(); }
}
