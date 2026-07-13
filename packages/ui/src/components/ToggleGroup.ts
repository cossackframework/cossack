import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, ClientState, Client } from "@cossackframework/core";

export interface ToggleGroupProps {
    /** Selection mode. */
    type?: "single" | "multiple";
    /** Selected value(s). */
    value?: string | string[];
    /** Items: [{ value, label }]. */
    items?: Array<{ value: string; label?: unknown; disabled?: boolean }>;
    /** Callback when selection changes. */
    onChange?: (value: string | string[]) => void;
    [key: string]: any;
}

/**
 * Cossack UI ToggleGroup — a group of toggle buttons (single or multi-select).
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

    @Client()
    onMount() {
        if (this.props.value) {
            this.selected = Array.isArray(this.props.value) ? [...this.props.value] : [this.props.value];
        }
    }

    isSelected(value: string): boolean {
        return this.selected.includes(value);
    }

    toggle(value: string) {
        const type = this.props.type || "single";
        if (type === "single") {
            this.selected = this.isSelected(value) ? [] : [value];
        } else {
            this.selected = this.isSelected(value)
                ? this.selected.filter((v) => v !== value)
                : [...this.selected, value];
        }
        this.props.onChange?.(type === "single" ? this.selected[0] || "" : this.selected);
    }

    render() {
        const { items = [] } = this.props;

        return html`
            <div class="cs-toggle-group inline-flex items-center gap-1 rounded-md bg-muted p-1">
                ${items.map((item) => {
                    const active = this.isSelected(item.value);
                    return html`
                        <button
                            type="button"
                            ?disabled=${!!item.disabled}
                            class=${classMap({
                                "cs-toggle-group__item": true,
                                "px-3 py-1.5 text-sm font-medium rounded-sm transition-colors border-none cursor-pointer": true,
                                "bg-background text-foreground shadow-sm": active,
                                "text-muted-foreground hover:text-foreground bg-transparent": !active,
                                "opacity-50 cursor-not-allowed": !!item.disabled,
                            })}
                            @click=${() => this.toggle(item.value)}
                        >${item.label ?? item.value}</button>
                    `;
                })}
            </div>
        `;
    }
}
