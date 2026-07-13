import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface SelectProps {
    /** Visual style. */
    variant?: "default" | "error";
    /** Control size. */
    size?: "sm" | "md" | "lg";
    /** Pass-through HTML select attributes (name, value, disabled, ...). */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<SelectProps["variant"]>, string> = {
    default: "border-border bg-background text-foreground",
    error: "border-destructive bg-background text-foreground",
};

const SIZES: Record<NonNullable<SelectProps["size"]>, string> = {
    sm: "text-sm px-2.5 py-1.5",
    md: "text-base px-3 py-2",
    lg: "text-lg px-4 py-2.5",
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
        const { variant = "default", size = "md", ...rest } = this.props;

        const wrapperClasses = classMap({
            "cs-select": true,
            "relative inline-block w-full": true,
        });

        const selectClasses = classMap({
            "cs-select__input": true,
            [`cs-select--${variant}`]: true,
            [`cs-select--${size}`]: true,
            "appearance-none w-full rounded-md border outline-none transition-colors duration-150": true,
            "focus:border-muted-foreground": true,
            "disabled:opacity-50 disabled:cursor-not-allowed": true,
            "pr-9": true,
            [VARIANTS[variant]]: true,
            [SIZES[size]]: true,
        });

        return html`
            <div class=${wrapperClasses}>
                <select class=${selectClasses} ...=${rest}>
                    ${this.children}
                </select>
                <span class="cs-select__icon pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground inline-flex">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
            </div>
        `;
    }
}
