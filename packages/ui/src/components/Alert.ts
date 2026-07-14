import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface AlertProps {
    /** Semantic tone; drives border + background tint. */
    variant?: "info" | "success" | "warning" | "destructive";
    /** Render an accent stripe on the left edge. */
    accent?: boolean;
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<AlertProps["variant"]>, string> = {
    info: "bg-secondary text-secondary-foreground",
    success: "bg-success/10 text-foreground border-success/40",
    warning: "bg-warning/10 text-foreground border-warning/40",
    destructive: "bg-destructive/10 text-foreground border-destructive/40",
};

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

        const classes = classMap({
            "cs-alert": true,
            [`cs-alert--${variant}`]: true,
            "relative w-full rounded-md border p-4 text-sm": true,
            "border-l-4": accent,
            [VARIANTS[variant]]: true,
        });

        return html`
            <div class="${classes}" role="alert" ...=${rest}>
                ${this.children}
            </div>
        `;
    }
}
