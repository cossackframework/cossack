import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface InputProps {
    /** Visual style. "error" applies destructive borders/ring. */
    variant?: "default" | "error";
    /** Control size. Defaults to "default" (h-9). */
    size?: "default" | "sm" | "lg";
    /** Pass-through HTML input attributes (type, placeholder, value, name, ...). */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<InputProps["variant"]>, string> = {
    default: "",
    error:
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 border-destructive focus-visible:ring-destructive/20",
};

const SIZES: Record<NonNullable<InputProps["size"]>, string> = {
    default: "h-9 px-3 py-1 text-base md:text-sm",
    sm: "h-8 rounded-md px-2 text-sm",
    lg: "h-10 rounded-md px-4 text-base",
};

/**
 * Cossack UI Input — token-driven text control.
 *
 * Use via `component(Input, { type: 'email', placeholder: 'you@ex.com', '.value': this.email, '@input': handler })`.
 */
@Component()
export class Input extends Cossack {
    declare props: InputProps;

    render() {
        const { variant = "default", size = "default", ...rest } = this.props;

        const classes = classMap({
            "cs-input": true,
            [`cs-input--${variant}`]: true,
            [`cs-input--${size}`]: true,
            "w-full min-w-0 rounded-md border bg-transparent": true,
            "text-base shadow-xs outline-none md:text-sm": true,
            "transition-[color,box-shadow]": true,
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]": true,
            "aria-invalid:border-destructive aria-invalid:ring-destructive/20": true,
            "placeholder:text-muted-foreground": true,
            "file:inline-flex file:border-0 file:bg-transparent file:text-foreground file:text-sm file:font-medium": true,
            "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50": true,
            [VARIANTS[variant]]: true,
            [SIZES[size]]: true,
        });

        return html`
            <input class="${classes}" ...=${rest} />
        `;
    }
}
