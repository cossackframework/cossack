import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface NativeSelectProps {
    /** Control size. */
    size?: "sm" | "md" | "lg";
    /** Visual style. */
    variant?: "default" | "error";
    /** Pass-through HTML select attributes (name, value, disabled, ...). */
    [key: string]: any;
}

const SIZES: Record<NonNullable<NativeSelectProps["size"]>, string> = {
    sm: "text-sm px-2.5 py-1.5",
    md: "text-base px-3 py-2",
    lg: "text-lg px-4 py-2.5",
};

const VARIANTS: Record<NonNullable<NativeSelectProps["variant"]>, string> = {
    default: "border-border bg-background text-foreground",
    error: "border-destructive bg-background text-foreground",
};

/**
 * Cossack UI NativeSelect — styled native `<select>` (no popover, no JS).
 *
 * A simpler alternative to the custom `Select` for cases where native OS-level
 * dropdown behavior is preferred (mobile-friendly, accessible by default).
 * Pass `<option>` elements as children.
 *
 *   ${component(NativeSelect, { '@change': handler },
 *       html\`<option value="a">A</option><option value="b">B</option>\`)}
 */
@Component()
export class NativeSelect extends Cossack {
    declare props: NativeSelectProps;

    render() {
        const { size = "md", variant = "default", ...rest } = this.props;

        return html`
            <div class="cs-native-select relative inline-block w-full">
                <select
                    class=${classMap({
                        "cs-native-select__input": true,
                        [`cs-native-select--${variant}`]: true,
                        [`cs-native-select--${size}`]: true,
                        "appearance-none w-full rounded-md border outline-none transition-colors transition-shadow": true,
                        "focus:border-primary focus:ring-2 focus:ring-primary/20": true,
                        "disabled:opacity-50 disabled:cursor-not-allowed": true,
                        "pr-9": true,
                        [VARIANTS[variant]]: true,
                        [SIZES[size]]: true,
                    })}
                    ...=${rest}
                >
                    ${this.children}
                </select>
                <span class="cs-native-select__icon pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground inline-flex">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
            </div>
        `;
    }
}
