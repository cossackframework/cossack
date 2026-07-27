import { html, component } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client, OnWindow, Shared } from '@cossackframework/core';
import { Modal } from '../../components/Modal.js';
import { Icon } from '../../icons/Icon.js';
import { Kbd } from '../../components/Kbd.js';
import { MagnifierIcon as magnifier } from '@cossackframework/solar-icons/magnifier';
import type { IconEntry } from '@cossackframework/solar-icons/types';

export interface CommandItem {
    /** Unique id. */
    id: string;
    /** Label shown in the list. */
    label: string;
    /** Optional category for grouping. */
    group?: string;
    /** Tree-shakeable icon entry from @cossackframework/solar-icons. */
    icon?: IconEntry;
    /** Optional keyboard shortcut hint, e.g. "⌘K". */
    shortcut?: string;
}

export interface CommandPaletteProps {
    /** All selectable commands. */
    commands: CommandItem[];
    /** Placeholder for the search input. */
    placeholder?: string;
    /** Called when a command is selected (clicked or Enter). */
    onSelect?: (id: string) => void;
    /** Controlled open state. Omit to let the palette manage its own state. */
    open?: boolean;
    /** Called whenever the palette opens or closes. */
    onOpenChange?: (open: boolean) => void;
    [key: string]: any;
}

/**
 * Command Palette Block — ⌘K-style command launcher.
 *
 * A Modal containing a search input and a filtered, grouped list of commands.
 * Opens via Cmd/Ctrl+K (listens on window). Arrow keys navigate, Enter
 * selects, Escape closes (native dialog behavior).
 *
 *   ${component(CommandPalette, {
 *       commands: [
 *           { id: 'home', label: 'Go to Home', group: 'Navigation', icon: HamburgerMenuIcon },
 *           { id: 'settings', label: 'Open Settings', group: 'Navigation', shortcut: '⌘,' },
 *           { id: 'delete', label: 'Delete item', group: 'Actions', icon: TrashBinMinimalisticIcon },
 *       ],
 *       onSelect: (id) => { navigate(id); },
 *   })}
 */
@Component()
export class CommandPalette extends Cossack {
    declare props: CommandPaletteProps;

    @ClientState() private open = false;
    @ClientState() private query = '';
    @ClientState() private activeIndex = 0;

    render() {
        const {
            commands = [],
            placeholder = 'Type a command…',
            open: _open,
            onOpenChange: _onOpenChange,
            onSelect: _onSelect,
            ...rest
        } = this.props;
        const filtered = this.filterCommands(commands);
        const groups = this.groupCommands(filtered);

        return html`
            ${component(Modal, {
                open: this.props.open ?? this.open,
                onClose: () => { this.setOpen(false); },
                closeOnBackdrop: true,
            }, html`
                <div class="cs-command-palette flex flex-col gap-2" ...=${rest}>
                    <div class="flex items-center gap-2 border-b pb-2">
                        ${component(Icon, { entry: magnifier, size: 18 })}
                        <input
                            type="text"
                            autofocus
                            class="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
                            placeholder=${placeholder}
                            .value=${this.query}
                            @input=${(e: InputEvent) => { this.query = (e.target as HTMLInputElement).value; this.activeIndex = 0; }}
                            @keydown=${(e: KeyboardEvent) => this.handleKeydown(e, filtered)}
                        />
                        ${component(Kbd, {}, 'Esc')}
                    </div>
                    <div class="max-h-[300px] overflow-y-auto flex flex-col gap-1">
                        ${filtered.length === 0
                            ? html`<p class="text-sm text-muted-foreground text-center py-6">No results found.</p>`
                            : groups.map((group) => html`
                                <div class="flex flex-col">
                                    ${group.name ? html`<span class="text-xs font-medium text-muted-foreground px-2 py-1.5">${group.name}</span>` : null}
                                    ${group.items.map((item) => {
                                        const idx = filtered.indexOf(item);
                                        return html`
                                            <button
                                                type="button"
                                                class=${`flex items-center gap-3 px-2 py-2 rounded-sm text-sm cursor-pointer border-none outline-none transition-colors ${idx === this.activeIndex ? 'bg-accent text-accent-foreground' : 'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground'}`}
                                                @click=${() => this.select(item.id)}
                                                @mouseenter=${() => { this.activeIndex = idx; }}
                                            >
                                                ${item.icon
                                                    ? html`<span class="text-muted-foreground [&_svg]:size-4">${component(Icon, { entry: item.icon, size: 16 })}</span>`
                                                    : html`<span class="size-4 shrink-0"></span>`}
                                                <span class="flex-1 text-left">${item.label}</span>
                                                ${item.shortcut ? component(Kbd, {}, item.shortcut) : null}
                                            </button>
                                        `;
                                    })}
                                </div>
                            `)}
                    </div>
                </div>
            `)}
        `;
    }

    @Shared()
    private filterCommands(commands: CommandItem[]): CommandItem[] {
        const q = this.query.trim().toLowerCase();
        if (!q) return commands;
        return commands.filter((c) => c.label.toLowerCase().includes(q));
    }

    @Shared()
    private groupCommands(items: CommandItem[]): Array<{ name: string; items: CommandItem[] }> {
        const map = new Map<string, CommandItem[]>();
        for (const item of items) {
            const g = item.group || '';
            if (!map.has(g)) map.set(g, []);
            map.get(g)!.push(item);
        }
        return [...map.entries()].map(([name, items]) => ({ name, items }));
    }

    @Client()
    private handleKeydown(e: KeyboardEvent, filtered: CommandItem[]) {
        if (filtered.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.activeIndex = (this.activeIndex + 1) % filtered.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.activeIndex = (this.activeIndex - 1 + filtered.length) % filtered.length;
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const item = filtered[this.activeIndex];
            if (item) this.select(item.id);
        }
    }

    @Client()
    private select(id: string) {
        this.setOpen(false);
        this.query = '';
        this.activeIndex = 0;
        this.props.onSelect?.(id);
    }

    @Client()
    private setOpen(open: boolean) {
        this.open = open;
        this.props.onOpenChange?.(open);
    }

    /** Toggle the palette open/closed — call from a button or menu. */
    @Client()
    toggle() {
        const next = !(this.props.open ?? this.open);
        this.setOpen(next);
        if (!next) {
            this.query = '';
            this.activeIndex = 0;
        }
    }

    /** Listen for the global ⌘K / Ctrl+K shortcut. */
    @OnWindow('keydown')
    onGlobalKeydown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            this.toggle();
        }
    }
}
