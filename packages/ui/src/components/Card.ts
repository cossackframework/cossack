import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface CardProps {
    /** Adds a hover lift effect (shadow + slight translate). */
    interactive?: boolean;
    /** Optional padding modifier for the body slot. */
    padding?: "none" | "sm" | "default" | "lg";
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

const PADDINGS: Record<NonNullable<CardProps["padding"]>, string> = {
    none: "",
    sm: "p-4",
    default: "p-6",
    lg: "p-8",
};

/**
 * Cossack UI Card — surface container with optional header/footer slots.
 *
 * Compose with `CardHeader`, `CardBody`, `CardFooter`, or just pass content:
 *   `component(Card, { interactive: true }, html\`<h3>Title</h3><p>Body</p>\`)`.
 */
@Component()
export class Card extends Cossack {
    declare props: CardProps;

    render() {
        const { interactive = false, padding = "default", ...rest } = this.props;

        const classes = classMap({
            "cs-card": true,
            "rounded-xl border bg-card text-card-foreground shadow-xs": true,
            "transition-shadow transition-transform duration-150 hover:shadow-md hover:-translate-y-0.5 cursor-pointer": interactive,
            [PADDINGS[padding]]: !!PADDINGS[padding],
        });

        return html`
            <div class="${classes}" ...=${rest}>
                ${this.children}
            </div>
        `;
    }
}

/** Optional header slot. */
@Component()
export class CardHeader extends Cossack {
    declare props: { [key: string]: any };

    render() {
        return html`
            <div class="cs-card-header flex flex-col gap-1.5 p-6" ...=${this.props}>
                ${this.children}
            </div>
        `;
    }
}

/** Optional body slot with consistent padding. */
@Component()
export class CardBody extends Cossack {
    declare props: { [key: string]: any };

    render() {
        return html`
            <div class="cs-card-body p-6 pt-0" ...=${this.props}>
                ${this.children}
            </div>
        `;
    }
}

/** Optional footer slot. */
@Component()
export class CardFooter extends Cossack {
    declare props: { [key: string]: any };

    render() {
        return html`
            <div class="cs-card-footer flex items-center p-6 pt-0" ...=${this.props}>
                ${this.children}
            </div>
        `;
    }
}
