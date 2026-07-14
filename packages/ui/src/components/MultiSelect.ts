import { html, classMap, component } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    ClientState,
    OnWindow,
    createRef,
    type RefObject,
} from "@cossackframework/core";
import { Icon } from "../icons/Icon";

export interface MultiSelectProps {
    /** Predefined options to pick from. */
    options?: string[];
    /** Currently selected values. */
    value?: string[];
    /** Placeholder for the input. */
    placeholder?: string;
    /** Allow creating new values not in `options`. Default true. */
    allowCreate?: boolean;
    /** Max number of selections. 0 = unlimited. */
    max?: number;
    /** Called whenever the selection changes. */
    onChange?: (value: string[]) => void;
    /** Validation: returns an error message if a new value is invalid, else null. */
    validate?: (value: string) => string | null;
    [key: string]: any;
}

/**
 * Cossack UI MultiSelect — tag input with search and create-new capability.
 *
 * Type to filter predefined options, click to select, or press Enter to add a
 * new tag (if `allowCreate` is true). Selected values appear as removable
 * chips. Backspace on an empty input removes the last chip.
 *
 *   ${component(MultiSelect, {
 *       options: ['TypeScript', 'React', 'Vue', 'Angular', 'Svelte'],
 *       value: this.skills,
 *       onChange: (v) => { this.skills = v; },
 *   })}
 */
@Component()
export class MultiSelect extends Cossack {
    declare props: MultiSelectProps;

    @ClientState() private query = "";
    @ClientState() private activeIndex = -1;

    inputRef: RefObject<HTMLInputElement> = createRef<HTMLInputElement>();
    private popoverId = `cs-multiselect-${Math.random().toString(36).slice(2, 9)}`;

    /** The selected values — fully controlled from props.value. */
    private get selected(): string[] {
        return this.props.value || [];
    }

    render() {
        const { options = [], placeholder = "Add tag..." } = this.props;
        const selected = this.selected;

        const filtered = this.query
            ? options.filter((o) => o.toLowerCase().includes(this.query.toLowerCase()) && !selected.includes(o))
            : options.filter((o) => !selected.includes(o));

        const canCreate =
            this.props.allowCreate !== false &&
            this.query.trim().length > 0 &&
            !options.some((o) => o.toLowerCase() === this.query.toLowerCase()) &&
            !selected.includes(this.query.trim());

        return html`
            <div class="cs-multiselect relative w-full">
                <!-- Tag chips + input -->
                <div
                    class="cs-multiselect__field flex flex-wrap items-center gap-1.5 min-h-9 w-full rounded-md border border-input bg-background px-2 py-1 cursor-text transition-[color,box-shadow] shadow-xs focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]"
                    @click=${() => this.inputRef.value?.focus()}
                >
                    ${selected.map((tag, i) => html`
                        <span class="cs-multiselect__tag inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-sm text-secondary-foreground">
                            ${tag}
                            <button
                                type="button"
                                class="cs-multiselect__tag-remove inline-flex items-center justify-center w-4 h-4 rounded-sm hover:text-foreground text-muted-foreground cursor-pointer border-none bg-transparent"
                                aria-label=${`Remove ${tag}`}
                                @click=${(e: MouseEvent) => { e.stopPropagation(); this.removeTag(i); }}
                            >
                                <span class="inline-flex items-center justify-center [&_svg]:size-2.5">${component(Icon, { name: "close-circle", size: 16 })}</span>
                            </button>
                        </span>
                    `)}
                    <input
                        ref=${this.inputRef}
                        type="text"
                        class="cs-multiselect__input flex-1 min-w-[80px] rounded-sm border border-dashed border-input bg-transparent px-1 outline-none text-sm text-foreground placeholder:text-muted-foreground focus:border-solid focus:border-ring focus:ring-ring/50 focus:ring-[3px] py-0.5"
                        placeholder=${selected.length === 0 ? placeholder : ""}
                        .value=${this.query}
                        @input=${(e: InputEvent) => { this.query = (e.target as HTMLInputElement).value; this.activeIndex = -1; this.openIfHasResults(); }}
                        @keydown=${(e: KeyboardEvent) => this.handleKeydown(e, filtered, canCreate)}
                        @focus=${() => this.openIfHasResults()}
                    />
                </div>
                <!-- Dropdown -->
                <div
                    id=${this.popoverId}
                    popover="manual"
                    class="cs-multiselect__dropdown bg-popover text-popover-foreground border rounded-md shadow-lg p-1 max-h-[200px] overflow-y-auto"
                    style="position:fixed;margin:0;"
                >
                    ${filtered.length === 0 && !canCreate
                        ? html`<div class="px-3 py-2 text-sm text-muted-foreground">No options.</div>`
                        : html`
                            ${filtered.map((opt, i) => html`
                                <button
                                    type="button"
                                    class=${classMap({
                                        "cs-multiselect__option": true,
                                        "w-full text-left px-3 py-1.5 text-sm rounded-sm cursor-pointer border-none transition-colors": true,
                                        "bg-accent text-accent-foreground": i === this.activeIndex,
                                        "bg-transparent hover:bg-accent hover:text-accent-foreground": i !== this.activeIndex,
                                    })}
                                    @click=${() => this.addTag(opt)}
                                    @mouseenter=${() => { this.activeIndex = i; }}
                                >${opt}</button>
                            `)}
                            ${canCreate
                                ? html`<button
                                    type="button"
                                    class=${classMap({
                                        "cs-multiselect__create": true,
                                        "w-full text-left px-3 py-1.5 text-sm rounded-sm cursor-pointer border-none transition-colors": true,
                                        "bg-accent text-accent-foreground": filtered.length === this.activeIndex,
                                        "bg-transparent hover:bg-accent hover:text-accent-foreground": filtered.length !== this.activeIndex,
                                    })}
                                    @click=${() => this.createTag()}
                                    @mouseenter=${() => { this.activeIndex = filtered.length; }}
                                >+ Create <span class="font-medium">"${this.query.trim()}"</span></button>`
                                : null}
                        `}
                </div>
            </div>
        `;
    }

    @Client()
    private handleKeydown(e: KeyboardEvent, filtered: string[], canCreate: boolean) {
        const total = filtered.length + (canCreate ? 1 : 0);
        if (e.key === "Backspace" && !this.query && this.selected.length > 0) {
            this.removeTag(this.selected.length - 1);
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (this.activeIndex >= 0 && this.activeIndex < filtered.length) {
                this.addTag(filtered[this.activeIndex]);
            } else if (this.activeIndex === filtered.length && canCreate) {
                this.createTag();
            } else if (canCreate) {
                this.createTag();
            } else if (filtered.length > 0) {
                this.addTag(filtered[0]);
            }
        } else if (e.key === "ArrowDown" && total > 0) {
            e.preventDefault();
            this.activeIndex = Math.min(this.activeIndex + 1, total - 1);
        } else if (e.key === "ArrowUp" && total > 0) {
            e.preventDefault();
            this.activeIndex = Math.max(this.activeIndex - 1, 0);
        } else if (e.key === "Escape") {
            this.query = "";
            this.hideDropdown();
        }
    }

    @Client()
    private addTag(tag: string) {
        if (this.selected.includes(tag)) return;
        if (this.props.max && this.selected.length >= this.props.max) return;
        this.props.onChange?.([...this.selected, tag]);
        this.query = "";
        this.activeIndex = -1;
        this.inputRef.value?.focus();
    }

    @Client()
    private createTag() {
        const tag = this.query.trim();
        if (!tag) return;
        if (this.props.validate) {
            const err = this.props.validate(tag);
            if (err) return;
        }
        this.addTag(tag);
    }

    @Client()
    private removeTag(index: number) {
        this.props.onChange?.(this.selected.filter((_, i) => i !== index));
    }

    @Client()
    private openIfHasResults() {
        const el = document.getElementById(this.popoverId) as any;
        const { options = [] } = this.props;
        const hasFiltered = this.query
            ? options.some((o) => o.toLowerCase().includes(this.query.toLowerCase()) && !this.selected.includes(o))
            : options.some((o) => !this.selected.includes(o));
        const canCreate = this.props.allowCreate !== false && this.query.trim().length > 0;
        if (hasFiltered || canCreate) {
            el?.showPopover?.();
            requestAnimationFrame(() => this.positionDropdown());
        } else {
            el?.hidePopover?.();
        }
    }

    /** Close on outside click (manual popover has no light dismiss). */
    @OnWindow("pointerdown")
    onPointerDown(e: PointerEvent) {
        const el = document.getElementById(this.popoverId);
        if (!el || !el.matches(":popover-open")) return;
        // Don't close if clicking inside the dropdown or the field.
        if (el.contains(e.target as Node)) return;
        const field = this.inputRef.value?.closest(".cs-multiselect");
        if (field && field.contains(e.target as Node)) return;
        this.hideDropdown();
    }

    @Client()
    private hideDropdown() {
        const el = document.getElementById(this.popoverId) as any;
        el?.hidePopover?.();
    }

    @Client()
    private positionDropdown() {
        const field = this.inputRef.value?.closest(".cs-multiselect__field") as HTMLElement;
        const popover = document.getElementById(this.popoverId);
        if (!field || !popover || !popover.matches(":popover-open")) return;
        const rect = field.getBoundingClientRect();
        popover.style.position = "fixed";
        popover.style.top = `${rect.bottom + 4}px`;
        popover.style.left = `${rect.left}px`;
        popover.style.width = `${rect.width}px`;
        popover.style.margin = "0";
    }
}
