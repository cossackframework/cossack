import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    ClientState,
    Client,
    createRef,
    type RefObject,
} from "@cossackframework/core";

export interface ToggleGroupProps {
    /** Selection mode. "single" slides one indicator; "multiple" highlights each. */
    type?: "single" | "multiple";
    /** Selected value(s). */
    value?: string | string[];
    /** Items: [{ value, label, disabled? }]. */
    items?: Array<{ value: string; label?: unknown; disabled?: boolean }>;
    /** Callback when selection changes. */
    onChange?: (value: string | string[]) => void;
    [key: string]: any;
}

/**
 * Cossack UI ToggleGroup — a group of toggle buttons (single or multi-select).
 *
 * In `single` mode, a sliding indicator (like Tabs) animates between the active
 * item. In `multiple` mode, each active item gets its own highlight (no slide).
 *
 *   ${component(ToggleGroup, {
 *       type: 'single', value: 'bold', items: [
 *           { value: 'bold', label: 'B' },
 *           { value: 'italic', label: 'I' },
 *       ],
 *   })}
 */
@Component()
export class ToggleGroup extends Cossack {
    declare props: ToggleGroupProps;

    @ClientState() selected: string[] = [];
    @ClientState() private indicatorStyle: string = "";

    groupRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();

    @Client()
    onMount() {
        if (this.props.value) {
            this.selected = Array.isArray(this.props.value)
                ? [...this.props.value]
                : [this.props.value];
        }
        requestAnimationFrame(() => this.updateIndicator());
    }

    onUpdate() {
        if (!this.isServer) requestAnimationFrame(() => this.updateIndicator());
    }

    @Client()
    isSelected(value: string): boolean {
        return this.selected.includes(value);
    }

    @Client()
    toggle(value: string) {
        const type = this.props.type || "single";
        if (type === "single") {
            this.selected = this.isSelected(value) ? [] : [value];
        } else {
            this.selected = this.isSelected(value)
                ? this.selected.filter((v) => v !== value)
                : [...this.selected, value];
        }
        this.props.onChange?.(
            type === "single" ? this.selected[0] || "" : this.selected,
        );
        requestAnimationFrame(() => this.updateIndicator());
    }

    /** Position the sliding indicator over the active item (single mode only). */
    @Client()
    private updateIndicator() {
        const group = this.groupRef.value;
        if (!group) return;
        const type = this.props.type || "single";
        if (type !== "single" || this.selected.length === 0) {
            this.indicatorStyle = "display:none";
            return;
        }
        const activeBtn = group.querySelector<HTMLElement>(
            `[data-value="${this.selected[0]}"]`,
        );
        if (!activeBtn) return;
        const left = activeBtn.offsetLeft;
        const w = activeBtn.offsetWidth;
        this.indicatorStyle =
            `left:${left}px;width:${w}px;top:4px;bottom:4px;` +
            `background:var(--color-background, #fff);border-radius:0.25rem;` +
            `box-shadow:0 1px 2px rgb(0 0 0 / 0.06);`;
    }

    render() {
        const { items = [], type = "single" } = this.props;
        const isSingle = type === "single";

        return html`
            <div
                ref=${this.groupRef}
                class="cs-toggle-group relative inline-flex items-center gap-1 rounded-md bg-muted p-1"
            >
                ${items.map((item) => {
                    const active = this.isSelected(item.value);
                    return html`
                        <button
                            type="button"
                            data-value=${item.value}
                            ?disabled=${!!item.disabled}
                            class=${classMap({
                                "cs-toggle-group__item": true,
                                "relative z-10 text-sm font-medium transition-colors border-none cursor-pointer": true,
                                "px-3 py-1.5 rounded-sm": true,
                                // In single mode, the indicator provides the bg.
                                "text-foreground": active,
                                "text-muted-foreground hover:text-foreground": !active,
                                // In multiple mode, each item has its own bg highlight.
                                "bg-background shadow-sm": active && !isSingle,
                                "bg-transparent": !active || isSingle,
                                "opacity-50 cursor-not-allowed": !!item.disabled,
                            })}
                            @click=${() => this.toggle(item.value)}
                        >${item.label ?? item.value}</button>
                    `;
                })}
                ${isSingle
                    ? html`<span
                          class="cs-toggle-group__indicator absolute z-0 transition-all duration-300 ease-in-out"
                          style=${this.indicatorStyle}
                      ></span>`
                    : null}
            </div>
        `;
    }
}
