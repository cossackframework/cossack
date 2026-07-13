import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface MarkerProps {
    /** Visual style of the marker. */
    variant?: "default" | "unread";
    [key: string]: any;
}

/**
 * Cossack UI Marker — date/section divider inside a message list.
 *
 * Renders a centered label between two horizontal rules (e.g. "Today",
 * "Yesterday"). The "unread" variant uses a destructive accent for
 * "New messages" dividers.
 *
 *   ${component(Marker, {}, 'Today')}
 *   ${component(Marker, { variant: 'unread' }, 'New messages')}
 */
@Component()
export class Marker extends Cossack {
    declare props: MarkerProps;

    render() {
        const { variant = "default" } = this.props;

        return html`
            <div class="cs-marker flex items-center gap-3 py-2">
                <div class="cs-marker__line flex-1 h-px bg-border"></div>
                <span class=${classMap({
                    "cs-marker__label": true,
                    "text-xs font-medium px-2 py-0.5 rounded-full": true,
                    "text-muted-foreground": variant === "default",
                    "text-destructive bg-destructive/10": variant === "unread",
                })}>${this.children}</span>
                <div class="cs-marker__line flex-1 h-px bg-border"></div>
            </div>
        `;
    }
}
