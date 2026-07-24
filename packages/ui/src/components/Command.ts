import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState, OnDocument } from "@cossackframework/core";

export interface CommandProps {
    /** Command items: [{ id, label, group? }]. */
    items?: Array<{ id: string; label: string; group?: string }>;
    /** Called when an item is selected. */
    onSelect?: (id: string) => void;
    /** Placeholder text. Default "Search...". */
    placeholder?: string;
    [key: string]: any;
}

/**
 * Cossack UI Command — ⌘K command palette with fuzzy search.
 *
 * Listens for ⌘K / Ctrl+K globally to toggle visibility. Type to filter items,
 * Arrow Up/Down to navigate, Enter to select, Escape to close.
 *
 *   ${component(Command, {
 *       items: [
 *           { id: 'home', label: 'Go Home', group: 'Navigation' },
 *           { id: 'settings', label: 'Settings', group: 'Navigation' },
 *       ],
 *       onSelect: (id) => this.handleCommand(id),
 *   })}
 */
@Component()
export class Command extends Cossack {
    declare props: CommandProps;

    @ClientState() private open = false;
    @ClientState() private query = "";
    @ClientState() private activeIndex = 0;

    get isOpen(): boolean {
        return this.props.open === undefined ? this.open : !!this.props.open;
    }

    @OnDocument("keydown")
    @Client()
    onGlobalKeydown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
            e.preventDefault();
            this.open = !this.open;
            if (!this.open) { this.query = ""; this.activeIndex = 0; }
        }
        if (e.key === "Escape" && this.open) {
            this.open = false;
            this.query = "";
            this.activeIndex = 0;
        }
    }

    getFiltered(): Array<{ id: string; label: string; group?: string }> {
        const { items = [] } = this.props;
        if (!this.query) return items;
        const q = this.query.toLowerCase();
        return items.filter((item) => item.label.toLowerCase().includes(q));
    }

    render() {
        const { placeholder = "Search..." } = this.props;

        if (!this.isOpen) return null;

        const filtered = this.getFiltered();

        return html`
            <div
                class="cs-command fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
                @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) this.setOpen(false); }}
            >
                <div class="absolute inset-0 bg-black/50"></div>
                <div class="cs-command__panel relative w-full max-w-xl mx-4 bg-popover text-popover-foreground rounded-lg border shadow-xl overflow-hidden">
                    <input
                        class="cs-command__input w-full px-4 py-3 text-sm bg-transparent border-none outline-none border-b border placeholder:text-muted-foreground"
                        placeholder=${placeholder}
                        .value=${this.query}
                        @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value; this.activeIndex = 0; }}
                        @keydown=${(e: KeyboardEvent) => this.handleKeydown(e, filtered)}
                        autofocus
                    />
                    <div class="cs-command__list max-h-[300px] overflow-y-auto p-2">
                        ${filtered.length === 0
                            ? html`<div class="px-3 py-6 text-center text-sm text-muted-foreground">No results found.</div>`
                            : filtered.map((item, i) => html`
                                <button
                                    type="button"
                                    class=${classMap({
                                        "cs-command__item": true,
                                        "w-full flex items-center px-3 py-2 text-sm rounded-md cursor-pointer border-none transition-colors text-left": true,
                                        "bg-accent text-accent-foreground": i === this.activeIndex,
                                        "bg-transparent hover:bg-accent hover:text-accent-foreground": i !== this.activeIndex,
                                    })}
                                    @click=${() => this.selectItem(item.id)}
                                    @mouseenter=${() => { this.activeIndex = i; }}
                                >
                                    ${item.group ? html`<span class="text-xs text-muted-foreground mr-2">${item.group}</span>` : null}
                                    ${item.label}
                                </button>
                            `)}
                    </div>
                </div>
            </div>
        `;
    }

    @Client()
    private handleKeydown(e: KeyboardEvent, filtered: Array<{ id: string }>) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            this.activeIndex = Math.min(this.activeIndex + 1, filtered.length - 1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            this.activeIndex = Math.max(this.activeIndex - 1, 0);
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[this.activeIndex]) {
                this.selectItem(filtered[this.activeIndex].id);
            }
        }
    }

    @Client()
    private selectItem(id: string) {
        this.props.onSelect?.(id);
        this.setOpen(false);
        this.query = "";
        this.activeIndex = 0;
    }

    @Client()
    private setOpen(open: boolean) {
        this.open = open;
        this.props.onOpenChange?.(open);
    }
}
