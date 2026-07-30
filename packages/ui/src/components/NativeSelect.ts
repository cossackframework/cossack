import { html, classMap, component } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import { Icon } from "../icons/Icon";
import { AltArrowDownIcon as altArrowDownIcon } from "@cossackframework/solar-icons/alt-arrow-down";

export interface NativeSelectProps {
    /** Control size. Defaults to "default". */
    size?: "default" | "sm" | "lg";
    /** Visual style. "error" applies destructive borders/ring. */
    variant?: "default" | "error";
    /** Pass-through HTML select attributes (name, value, disabled, ...). */
    [key: string]: any;
}

const SIZES: Record<NonNullable<NativeSelectProps["size"]>, string> = {
    default: "h-9 px-3 py-1 text-base md:text-sm pr-9",
    sm: "h-8 rounded-md px-2 text-sm pr-8",
    lg: "h-10 rounded-md px-4 text-base pr-10",
};

const VARIANTS: Record<NonNullable<NativeSelectProps["variant"]>, string> = {
    default: "",
    error:
        "border-destructive focus-visible:ring-destructive/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
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
        const { size = "default", variant = "default", ...rest } = this.props;

        return html`
            <div class="cs-native-select relative inline-block w-full">
                <select
                    class=${classMap({
                        "cs-native-select__input": true,
                        [`cs-native-select--${variant}`]: true,
                        [`cs-native-select--${size}`]: true,
                        // Keep the closed control aligned with transparent form
                        // fields. color-scheme still lets the browser theme the
                        // native option menu appropriately.
                        "appearance-none w-full rounded-md border bg-transparent text-foreground [color-scheme:light_dark]": true,
                        "dark:[color-scheme:dark]": true,
                        "shadow-xs outline-none": true,
                        "transition-[color,box-shadow]": true,
                        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]": true,
                        "aria-invalid:border-destructive aria-invalid:ring-destructive/20": true,
                        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50": true,
                        [VARIANTS[variant]]: true,
                        [SIZES[size]]: true,
                    })}
                    ...=${rest}
                >
                    ${this.children}
                </select>
                <span class="cs-native-select__icon pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground inline-flex">
                    ${component(Icon, { entry: altArrowDownIcon, size: 16 })}
                </span>
            </div>
        `;
    }
}
