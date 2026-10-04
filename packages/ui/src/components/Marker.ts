import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import type { GlobalAttributes } from "../native-attributes";

export type MarkerProps = GlobalAttributes<HTMLDivElement> & {
    /** Visual style only; unread does not announce or move focus. */
    variant?: "default" | "unread";
};

/** A readable date/section label between decorative lines. Children must be phrasing content. */
@Component()
export class Marker extends Cossack {
    declare props: MarkerProps;

    render() {
        const { variant = "default", ...rest } = this.props;
        if (!['default', 'unread'].includes(variant)) throw new Error('Marker variant must be default or unread.');
        return html`
            <div class="cs-marker flex items-center gap-3 py-2 w-full min-w-0" ...=${rest}>
                <span aria-hidden="true" class="cs-marker__line flex-1 h-px bg-border"></span>
                <span class=${classMap({
                    'cs-marker__label text-xs font-medium px-2 py-0.5 rounded-full min-w-0 text-center [overflow-wrap:anywhere]': true,
                    'text-muted-foreground': variant === 'default',
                    'text-destructive bg-destructive/10': variant === 'unread',
                })}>${this.children}</span>
                <span aria-hidden="true" class="cs-marker__line flex-1 h-px bg-border"></span>
            </div>
        `;
    }
}
