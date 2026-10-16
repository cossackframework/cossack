import type { GlobalAttributes } from '../native-attributes';
import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type BadgeProps = GlobalAttributes<HTMLSpanElement> & {
    /** Semantic color. Defaults to "default" (primary). */
    variant?:
        | "default"
        | "secondary"
        | "success"
        | "warning"
        | "destructive"
        | "outline";
}

const VARIANTS: Record<NonNullable<BadgeProps["variant"]>, string> = {
    default: "bg-primary text-primary-foreground border-transparent",
    secondary: "bg-secondary text-secondary-foreground border-transparent",
    success: "bg-success/10 text-success-text border-transparent",
    warning: "bg-warning/10 text-warning-text border-transparent",
    destructive: "bg-destructive/10 text-destructive border-transparent",
    outline: "border-input text-foreground",
};

/**
 * Cossack UI Badge — small status / label pill.
 *
 * Use as a component tag: `<${Badge} variant="success">Active</${Badge}>`.
 */
@Component()
export class Badge extends Cossack {
    declare props: BadgeProps;

    render() {
        const { variant = "default", ...rest } = this.props;
        if (!Object.hasOwn(VARIANTS, variant)) throw new Error("Badge requires a supported variant.");

        const classes = classMap({
            "cs-badge": true,
            [`cs-badge--${variant}`]: true,
            "inline-flex items-center gap-1": true,
            "rounded-md border px-2 py-0.5 text-xs font-medium": true,
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
