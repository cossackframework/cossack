import { html, classMap, component } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import { Icon } from "../icons/Icon";
import type { IconEntry } from "@cossackframework/solar-icons/types";
import { InfoCircleIcon } from "@cossackframework/solar-icons/info-circle";
import { CheckCircleIcon } from "@cossackframework/solar-icons/check-circle";
import { DangerTriangleIcon } from "@cossackframework/solar-icons/danger-triangle";
import { DangerCircleIcon } from "@cossackframework/solar-icons/danger-circle";

export interface AlertProps {
    /** Semantic tone; drives border + background tint. */
    variant?: "default" | "success" | "warning" | "destructive";
    /** Render an accent stripe on the left edge. */
    accent?: boolean;
    /** Optional title text (rendered in medium weight). */
    title?: string;
    /** Optional Solar icon name shown at the start. */
    icon?: IconEntry | null;
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

const VARIANTS: Record<NonNullable<AlertProps["variant"]>, string> = {
    default: "bg-card text-card-foreground border",
    success: "bg-success/10 text-success-text",
    warning: "bg-warning/10 text-warning-text",
    destructive: "bg-destructive/10 text-destructive",
};

const ICONS: Record<string, IconEntry> = {
    default: InfoCircleIcon,
    success: CheckCircleIcon,
    warning: DangerTriangleIcon,
    destructive: DangerCircleIcon,
};

/**
 * Cossack UI Alert — inline message block with semantic tones.
 *
 * shadcn-style: a simple bordered grid with an optional icon, title, and
 * description (passed as children). Default variant uses the card surface.
 *
 *   component(Alert, { variant: 'success', title: 'Saved', icon: 'check-circle' },
 *       html\`Your changes have been saved.\`)
 */
@Component()
export class Alert extends Cossack {
    declare props: AlertProps;

    render() {
        const { variant = "default", accent = false, title, icon, ...rest } = this.props;
        const iconEntry: IconEntry | undefined = icon !== undefined ? (icon ?? undefined) : ICONS[variant];

        const classes = classMap({
            "cs-alert": true,
            [`cs-alert--${variant}`]: true,
            "relative w-full grid gap-0.5 rounded-lg p-3 text-left text-sm [&_svg]:size-4 [&_svg]:translate-y-0.5 [&_svg]:text-current": true,
            "has-[svg]:grid-cols-[auto_1fr] has-[svg]:gap-x-2": !!iconEntry,
            "border-l-4": accent,
            [VARIANTS[variant]]: true,
        });

        return html`
            <div class="${classes}" role="alert" ...=${rest}>
                ${iconEntry
                    ? html`<span class="inline-flex items-start [&_svg]:size-4 [&_svg]:text-current">${component(Icon, { entry: iconEntry, size: 16 })}</span>`
                    : null}
                <div class=${iconEntry ? "col-start-2" : ""}>
                    ${title ? html`<div class="font-medium">${title}</div>` : null}
                    <div class="text-sm text-muted-foreground">${this.children}</div>
                </div>
            </div>
        `;
    }
}
