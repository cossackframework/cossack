import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface TextareaProps {
    /** Visual style. "error" applies destructive borders/ring. */
    variant?: "default" | "error";
    /** Control size. Defaults to "default". */
    size?: "default" | "sm" | "lg";
    /** Number of visible text rows. */
    rows?: number;
    /** Pass-through HTML textarea attributes (placeholder, name, ...). */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<TextareaProps["variant"]>, string> = {
    default: "",
    error:
        "border-destructive focus-visible:ring-destructive/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
};

const SIZES: Record<NonNullable<TextareaProps["size"]>, string> = {
    default: "px-3 py-2 text-base md:text-sm",
    sm: "rounded-md px-2 text-sm",
    lg: "rounded-md px-4 text-base",
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
            size = "default",
            rows = 4,
            ...rest
        } = this.props;

        const classes = classMap({
            "cs-textarea": true,
            [`cs-textarea--${variant}`]: true,
            [`cs-textarea--${size}`]: true,
            "w-full min-w-0 rounded-md border bg-transparent": true,
            "shadow-xs outline-none": true,
            "transition-[color,box-shadow]": true,
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]": true,
            "aria-invalid:border-destructive aria-invalid:ring-destructive/20": true,
            "placeholder:text-muted-foreground": true,
            "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50": true,
            "resize-y": true,
            [VARIANTS[variant]]: true,
            [SIZES[size]]: true,
        });

        return html`
            <textarea class=${classes} rows=${rows} ...=${rest}></textarea>
        `;
    }
}
