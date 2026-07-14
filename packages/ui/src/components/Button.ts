import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface ButtonProps {
    /** Visual style. Defaults to "default" (primary fill). */
    variant?:
        | "default"
        | "secondary"
        | "destructive"
        | "outline"
        | "ghost"
        | "link";
    /** Control size. Defaults to "default". "icon" renders a square button. */
    size?: "default" | "sm" | "lg" | "icon";
    /** Render as a block-level (full-width) button. */
    block?: boolean;
    /** Allow arbitrary HTML attributes / event handlers to spread onto the native button. */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
    default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
    secondary:
        "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
    destructive:
        "bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20 focus-visible:ring-destructive/20 focus-visible:border-destructive/40",
    outline:
        "border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    link: "text-primary underline-offset-4 hover:underline",
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
    default: "h-9 px-4 py-2 has-[>svg]:px-3",
    sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
    lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
    icon: "size-9",
};

/**
 * Cossack UI Button — token-driven, themeable.
 *
 * Use via `component(Button, { variant: 'default', '@click': handler }, 'Save')`.
 */
@Component()
export class Button extends Cossack {
    declare props: ButtonProps;

    render() {
        const { variant = "default", size = "default", block = false, ...rest } =
            this.props;

        const classes = classMap({
            "cs-button": true,
            [`cs-button--${variant}`]: true,
            [`cs-button--${size}`]: true,
            "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium": true,
            "transition-colors outline-none select-none": true,
            "disabled:pointer-events-none disabled:opacity-50": true,
            "[&_svg]:size-4 [&_svg]:shrink-0": true,
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:border-ring": true,
            "aria-invalid:ring-destructive/20 aria-invalid:border-destructive": true,
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
