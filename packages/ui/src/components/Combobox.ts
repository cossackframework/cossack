import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState, createRef, type RefObject } from "@cossackframework/core";

export interface ComboboxProps {
    /** Options: [{ value, label }]. */
    options?: Array<{ value: string; label: string }>;
    /** Current value. */
    value?: string;
    /** Placeholder text. Default "Search...". */
    placeholder?: string;
    /** Called when a value is selected. */
    onChange?: (value: string) => void;
    [key: string]: any;
}

/**
 * Cossack UI Combobox — searchable autocomplete input using native `popover`.
 *
 * Type to filter options, Arrow Down/Enter to select. The dropdown uses the
 * native `popover` attribute for top-layer positioning.
 *
 *   ${component(Combobox, {
 *       options: [{ value: 'us', label: 'United States' }, { value: 'vn', label: 'Vietnam' }],
 *       value: this.country,
 *       onChange: (v) => { this.country = v; },
 *   })}
 */
@Component()
export class Combobox extends Cossack {
    declare props: ComboboxProps;

    @ClientState() private query = "";
    @ClientState() private activeIndex = -1;
    @ClientState() private selectedLabel = "";

    inputRef: RefObject<HTMLInputElement> = createRef<HTMLInputElement>();
    private popoverId = `cs-combobox-${Math.random().toString(36).slice(2, 9)}`;

    render() {
        const { options = [], placeholder = "Search..." } = this.props;
        const displayValue = this.selectedLabel || options.find((o) => o.value === this.props.value)?.label || "";

        const filtered = this.query
            ? options.filter((o) => o.label.toLowerCase().includes(this.query.toLowerCase()))
            : options;

        return html`
            <div class="cs-combobox relative inline-block w-full">
                <input
                    ref=${this.inputRef}
                    type="text"
                    class="cs-combobox__input w-full rounded-md border border-input bg-background text-foreground text-sm px-3 py-2 outline-none transition-colors shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] cursor-pointer"
                    placeholder=${placeholder}
                    .value=${this.query || displayValue}
                    popovertarget=${this.popoverId}
                    @click=${() => { this.query = ""; this.activeIndex = -1; }}
                    @input=${(e: Event) => {
                        this.query = (e.target as HTMLInputElement).value;
                        this.activeIndex = -1;
                        this.showPopover();
                    }}
                    @keydown=${(e: KeyboardEvent) => this.handleKeydown(e, filtered)}
                />
                <div
                    id=${this.popoverId}
                    popover="auto"
                    class="cs-combobox__list bg-popover text-popover-foreground border rounded-md shadow-lg p-1 max-h-[200px] overflow-y-auto w-full"
                    style="position:fixed;margin:0;"
                    @toggle=${() => {}}
                >
                    ${filtered.length === 0
                        ? html`<div class="px-3 py-2 text-sm text-muted-foreground">No results.</div>`
                        : filtered.map((opt, i) => html`
                            <button
                                type="button"
                                class=${classMap({
                                    "cs-combobox__option": true,
                                    "w-full text-left px-3 py-1.5 text-sm rounded-sm cursor-pointer border-none transition-colors": true,
                                    "bg-accent text-accent-foreground": i === this.activeIndex,
                                    "bg-transparent hover:bg-accent hover:text-accent-foreground": i !== this.activeIndex,
                                })}
                                @click=${() => this.selectOption(opt.value, opt.label)}
                                @mouseenter=${() => { this.activeIndex = i; }}
                            >${opt.label}</button>
                        `)}
                </div>
            </div>
        `;
    }

    @Client()
    private handleKeydown(e: KeyboardEvent, filtered: Array<{ value: string; label: string }>) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            this.activeIndex = Math.min(this.activeIndex + 1, filtered.length - 1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            this.activeIndex = Math.max(this.activeIndex - 1, 0);
        } else if (e.key === "Enter" && this.activeIndex >= 0 && filtered[this.activeIndex]) {
            e.preventDefault();
            this.selectOption(filtered[this.activeIndex].value, filtered[this.activeIndex].label);
        }
    }

    @Client()
    private selectOption(value: string, label: string) {
        this.selectedLabel = label;
        this.query = "";
        this.activeIndex = -1;
        this.hidePopover();
        this.props.onChange?.(value);
    }

    @Client()
    private showPopover() {
        const el = document.getElementById(this.popoverId) as any;
        el?.showPopover?.();
        requestAnimationFrame(() => this.positionPopover());
    }

    @Client()
    private hidePopover() {
        const el = document.getElementById(this.popoverId) as any;
        el?.hidePopover?.();
    }

    @Client()
    private positionPopover() {
        const input = this.inputRef.value;
        const popover = document.getElementById(this.popoverId);
        if (!input || !popover || !popover.matches(":popover-open")) return;
        const rect = input.getBoundingClientRect();
        const gap = 4;
        popover.style.position = "fixed";
        popover.style.top = `${rect.bottom + gap}px`;
        popover.style.left = `${rect.left}px`;
        popover.style.width = `${rect.width}px`;
        popover.style.margin = "0";
    }
}
