import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface ButtonProps {
    /** Visual style. */
    variant?: "primary" | "secondary" | "destructive" | "ghost" | "outline";
    /** Control size. */
    size?: "sm" | "md" | "lg";
    /** Render as a block-level (full-width) button. */
    block?: boolean;
    /** Allow arbitrary HTML attributes / event handlers to spread onto the native button. */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    secondary: "bg-secondary text-secondary-foreground hover:opacity-80",
    destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
    outline:
        "border border-border bg-transparent text-foreground hover:bg-muted",
    ghost: "bg-transparent text-foreground hover:bg-muted",
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
    sm: "text-sm px-3 py-1.5",
    md: "text-base px-4 py-2",
    lg: "text-lg px-5 py-2.5",
};

/**
 * Cossack UI Button — token-driven, themeable.
 *
 * Use via `component(Button, { variant: 'primary', '@click': handler }, 'Save')`.
 */
@Component()
export class Button extends Cossack {
    declare props: ButtonProps;

    render() {
        const { variant = "primary", size = "md", block = false, ...rest } =
            this.props;

        const classes = classMap({
            "cs-button": true,
            [`cs-button--${variant}`]: true,
            [`cs-button--${size}`]: true,
            "inline-flex items-center justify-center gap-2 font-medium": true,
            "rounded-md cursor-pointer select-none": true,
            "transition-opacity transition-colors duration-150": true,
            "disabled:opacity-50 disabled:cursor-not-allowed": true,
            "w-full": block,
            [VARIANTS[variant]]: true,
            [SIZES[size]]: true,
        });

        return html`
            <button class="${classes}" ...=${rest}>
                ${this.children}
            </button>
        `;
    }
}
