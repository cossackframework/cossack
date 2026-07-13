import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface InputProps {
    /** Visual style. */
    variant?: "default" | "error";
    /** Control size. */
    size?: "sm" | "md" | "lg";
    /** Pass-through HTML input attributes (type, placeholder, value, name, ...). */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<InputProps["variant"]>, string> = {
    default: "border-border bg-background text-foreground",
    error: "border-destructive bg-background text-foreground",
};

const SIZES: Record<NonNullable<InputProps["size"]>, string> = {
    sm: "text-sm px-2.5 py-1.5",
    md: "text-base px-3 py-2",
    lg: "text-lg px-4 py-2.5",
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
        const { variant = "default", size = "md", ...rest } = this.props;

        const classes = classMap({
            "cs-input": true,
            [`cs-input--${variant}`]: true,
            [`cs-input--${size}`]: true,
            "w-full rounded-md border outline-none transition-colors duration-150": true,
            "focus:border-muted-foreground": true,
            "placeholder:text-muted-foreground": true,
            "disabled:opacity-50 disabled:cursor-not-allowed": true,
            [VARIANTS[variant]]: true,
            [SIZES[size]]: true,
        });

        return html`
            <input class="${classes}" ...=${rest} />
        `;
    }
}
