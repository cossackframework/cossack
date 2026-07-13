import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface KbdProps {
    [key: string]: any;
}

/**
 * Cossack UI Kbd — keyboard key indicator (e.g. ⌘ + K).
 *
 *   ${component(Kbd, {}, '⌘')}
 *   ${component(Kbd, {}, 'K')}
 */
@Component()
export class Kbd extends Cossack {
    declare props: KbdProps;

    render() {
        const classes = classMap({
            "cs-kbd": true,
            "inline-flex items-center justify-center": true,
            "min-w-[1.5rem] h-6 px-1.5 text-xs font-medium": true,
            "rounded border border-border bg-muted text-muted-foreground": true,
            "select-none": true,
        });

        return html`<kbd class=${classes} ...=${this.props}>${this.children}</kbd>`;
    }
}
