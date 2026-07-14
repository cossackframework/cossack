import { html, classMap, component } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import { Icon } from "../icons/Icon";

export interface SelectProps {
    /** Visual style. "error" applies destructive borders/ring. */
    variant?: "default" | "error";
    /** Control size. Defaults to "default". */
    size?: "default" | "sm" | "lg";
    /** Pass-through HTML select attributes (name, value, disabled, ...). */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<SelectProps["variant"]>, string> = {
    default: "",
    error:
        "border-destructive focus-visible:ring-destructive/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
};

const SIZES: Record<NonNullable<SelectProps["size"]>, string> = {
    default: "h-9 px-3 py-1 text-base md:text-sm pr-9",
    sm: "h-8 rounded-md px-2 text-sm pr-8",
    lg: "h-10 rounded-md px-4 text-base pr-10",
};

/**
 * Cossack UI Select — native `<select>` with `<option>` children passed through
 * `this.children`. A chevron icon overlays the control via appearance-none.
 *
 *   ${component(Select, { '@change': handler },
 *       html\`<option value="a">A</option><option value="b">B</option>\`)}
 */
@Component()
export class Select extends Cossack {
    declare props: SelectProps;

    render() {
        const { variant = "default", size = "default", ...rest } = this.props;

        const wrapperClasses = classMap({
            "cs-select": true,
            "relative inline-block w-full": true,
        });

        const selectClasses = classMap({
            "cs-select__input": true,
            [`cs-select--${variant}`]: true,
            [`cs-select--${size}`]: true,
            "appearance-none w-full rounded-md border bg-transparent": true,
            "shadow-xs outline-none": true,
            "transition-[color,box-shadow]": true,
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]": true,
            "aria-invalid:border-destructive aria-invalid:ring-destructive/20": true,
            "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50": true,
            [VARIANTS[variant]]: true,
            [SIZES[size]]: true,
        });

        return html`
            <div class=${wrapperClasses}>
                <select class=${selectClasses} ...=${rest}>
                    ${this.children}
                </select>
                <span class="cs-select__icon pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground inline-flex">
                    ${component(Icon, { name: "alt-arrow-down", size: 16 })}
                </span>
            </div>
        `;
    }
}
