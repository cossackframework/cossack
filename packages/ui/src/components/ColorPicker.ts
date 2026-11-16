import { html } from "@cossackframework/renderer";
import { Client, Component, Cossack } from "@cossackframework/core";

export type ColorPickerProps = {
    /** The element ID of the color input. */
    id?: string;
    /** Any CSS color; the swatch shows it, and the picker starts from it when it is a hex color. */
    value: string;
    /** Spoken and hover name of the picker. */
    label: string;
    disabled?: boolean;
    /** Classes of the swatch; the default is a 2rem square. */
    class?: string;
    /** The picked color, as `#rrggbb`. */
    onChange?(value: string): void;
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Cossack UI ColorPicker — one rounded swatch showing the current color; clicking it opens the
 * browser's color picker. Values the picker cannot show, such as `oklch()`, still show on the
 * swatch, and the picker starts from black.
 *
 *   <${ColorPicker} label="Accent" .value=${this.accent} .onChange=${value => (this.accent = value)} />
 */
@Component()
export class ColorPicker extends Cossack {
    declare props: ColorPickerProps;

    @Client()
    private pick(event: Event) {
        this.props.onChange?.((event.target as HTMLInputElement).value);
    }

    render() {
        const { id, value = "", label, disabled = false } = this.props;
        const size = this.props.class ?? "h-8 w-8";
        return html`<span class=${`cs-color-picker relative inline-flex shrink-0 overflow-hidden rounded-md border border-border shadow-xs focus-within:ring-[3px] focus-within:ring-ring/50 ${disabled ? "opacity-50" : "cursor-pointer"} ${size}`}
            style=${`background: ${value || "transparent"}`} title=${label}>
            <input type="color" id=${id} class="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" .value=${HEX.test(value) ? value : "#000000"}
                aria-label=${label} ?disabled=${disabled} @input=${(event: Event) => this.pick(event)} />
        </span>`;
    }
}
