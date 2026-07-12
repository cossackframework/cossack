import { html } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface AlertProps {
    /** Semantic tone; drives border + background tint. */
    variant?: "info" | "success" | "warning" | "destructive";
    /** Render an accent stripe on the left edge. */
    accent?: boolean;
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

/**
 * Cossack UI Alert — inline message block with semantic tones.
 *
 * Use via:
 *   component(Alert, { variant: 'success' }, html\`<strong>Done!</strong> Saved.\`)
 */
@Component()
export class Alert extends Cossack {
    declare props: AlertProps;

    render() {
        const { variant = "info", accent = false, ...rest } = this.props;

        const variants: Record<NonNullable<AlertProps["variant"]>, string> = {
            info: "bg-secondary text-secondary-foreground border-border",
            success:
                "bg-success/10 text-foreground border-success/40",
            warning:
                "bg-warning/10 text-foreground border-warning/40",
            destructive:
                "bg-destructive/10 text-foreground border-destructive/40",
        };

        const classes = [
            "cs-alert",
            `cs-alert--${variant}`,
            "relative w-full rounded-md border p-4 text-sm",
            accent ? "border-l-4" : "",
            variants[variant],
        ]
            .filter(Boolean)
            .join(" ");

        return html`
            <div class="${classes}" role="alert" ...=${rest}>
                ${this.children}
            </div>
        `;
    }
}
