import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface TextareaProps {
    /** Visual style. */
    variant?: "default" | "error";
    /** Control size (padding). */
    size?: "sm" | "md" | "lg";
    /** Number of visible text rows. */
    rows?: number;
    /** Pass-through HTML textarea attributes (placeholder, name, ...). */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<TextareaProps["variant"]>, string> = {
    default: "border-border bg-background text-foreground",
    error: "border-destructive bg-background text-foreground",
};

const SIZES: Record<NonNullable<TextareaProps["size"]>, string> = {
    sm: "text-sm px-2.5 py-1.5",
    md: "text-base px-3 py-2",
    lg: "text-lg px-4 py-2.5",
};

/**
 * Cossack UI Textarea — token-driven multiline text control.
 *
 *   ${component(Textarea, { rows: 4, placeholder: 'Write something…' })}
 */
@Component()
export class Textarea extends Cossack {
    declare props: TextareaProps;

    render() {
        const {
            variant = "default",
            size = "md",
            rows = 4,
            ...rest
        } = this.props;

        const classes = classMap({
            "cs-textarea": true,
            [`cs-textarea--${variant}`]: true,
            [`cs-textarea--${size}`]: true,
            "w-full rounded-md border outline-none transition-colors duration-150": true,
            "focus:border-primary": true,
            "placeholder:text-muted-foreground": true,
            "disabled:opacity-50 disabled:cursor-not-allowed": true,
            "resize-y": true,
            [VARIANTS[variant]]: true,
            [SIZES[size]]: true,
        });

        return html`
            <textarea class=${classes} rows=${rows} ...=${rest}></textarea>
        `;
    }
}
