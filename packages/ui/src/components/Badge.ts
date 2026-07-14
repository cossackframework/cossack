import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface BadgeProps {
    /** Semantic color. Defaults to "default" (primary). */
    variant?:
        | "default"
        | "secondary"
        | "success"
        | "warning"
        | "destructive"
        | "outline";
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<BadgeProps["variant"]>, string> = {
    default: "bg-primary text-primary-foreground",
    secondary: "bg-secondary text-secondary-foreground",
    success: "bg-success text-success-foreground",
    warning: "bg-warning text-warning-foreground",
    destructive: "bg-destructive text-destructive-foreground",
    outline: "border border-border text-foreground",
};

/**
 * Cossack UI Badge — small status / label pill.
 *
 * Use via `component(Badge, { variant: 'success' }, 'Active')`.
 */
@Component()
export class Badge extends Cossack {
    declare props: BadgeProps;

    render() {
        const { variant = "default", ...rest } = this.props;

        const classes = classMap({
            "cs-badge": true,
            [`cs-badge--${variant}`]: true,
            "inline-flex items-center gap-1": true,
            "rounded-md border border-transparent px-2 py-0.5 text-xs font-medium": true,
            "w-fit whitespace-nowrap shrink-0": true,
            "[&_svg]:size-3 [&_svg]:shrink-0": true,
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none": true,
            "transition-colors": true,
            [VARIANTS[variant]]: true,
        });

        return html`
            <span class="${classes}" ...=${rest}>
                ${this.children}
            </span>
        `;
    }
}
