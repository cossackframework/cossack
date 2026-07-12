import { html } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface BadgeProps {
    /** Semantic color. */
    variant?:
        | "primary"
        | "secondary"
        | "success"
        | "warning"
        | "destructive"
        | "outline";
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

/**
 * Cossack UI Badge — small status / label pill.
 *
 * Use via `component(Badge, { variant: 'success' }, 'Active')`.
 */
@Component()
export class Badge extends Cossack {
    declare props: BadgeProps;

    render() {
        const { variant = "primary", ...rest } = this.props;

        const variants: Record<NonNullable<BadgeProps["variant"]>, string> = {
            primary: "bg-primary text-primary-foreground",
            secondary: "bg-secondary text-secondary-foreground",
            success: "bg-success text-success-foreground",
            warning: "bg-warning text-warning-foreground",
            destructive: "bg-destructive text-destructive-foreground",
            outline: "border border-border bg-transparent text-foreground",
        };

        const classes = [
            "cs-badge",
            `cs-badge--${variant}`,
            "inline-flex items-center gap-1",
            "text-xs font-medium px-2 py-0.5 rounded-full",
            variants[variant],
        ]
            .filter(Boolean)
            .join(" ");

        return html`
            <span class="${classes}" ...=${rest}>
                ${this.children}
            </span>
        `;
    }
}
