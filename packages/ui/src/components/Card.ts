import type { GlobalAttributes } from '../native-attributes';
import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type CardProps = GlobalAttributes<HTMLDivElement> & {
    /** Adds a hover lift effect (shadow + slight translate). */
    hoverable?: boolean;
    /** Padding on the Card root only; slots retain their own padding. */
    padding?: "none" | "sm" | "default" | "lg";
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
 *   `component(Card, { hoverable: true }, html\`<h3>Title</h3><p>Body</p>\`)`.
 */
@Component()
export class Card extends Cossack {
    declare props: CardProps;

    render() {
        const { hoverable = false, padding = "default", ...rest } = this.props;
        if (!Object.hasOwn(PADDINGS, padding)) throw new Error("Card padding must be none, sm, default or lg.");

        const classes = classMap({
            "cs-card": true,
            "rounded-xl border bg-card text-card-foreground shadow-xs": true,
            "transition-[box-shadow,translate] duration-150 hover:shadow-md hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0": hoverable,
            [PADDINGS[padding]]: !!PADDINGS[padding],
        });

        return html`
            <div class="${classes}" ...=${rest}>
                ${this.children}
            </div>
        `;
    }
}

export type CardHeaderProps = GlobalAttributes<HTMLDivElement>;
export type CardBodyProps = GlobalAttributes<HTMLDivElement>;
export type CardFooterProps = GlobalAttributes<HTMLDivElement>;

/** Optional header slot. */
@Component()
export class CardHeader extends Cossack {
    declare props: CardHeaderProps;

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
    declare props: CardBodyProps;

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
    declare props: CardFooterProps;

    render() {
        return html`
            <div class="cs-card-footer flex items-center p-6 pt-0" ...=${this.props}>
                ${this.children}
            </div>
        `;
    }
}
