import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import type { GlobalAttributes } from "../native-attributes";

export type MessageProps = GlobalAttributes<HTMLDivElement> & {
    /** Optional sender display name, for either variant. */
    name?: string;
    /** Display text; without datetime this stays ordinary text. */
    time?: string;
    /** HTML machine-readable timestamp. Requires nonempty time text. */
    datetime?: string;
    variant?: "sent" | "received";
    /** Avatar content for either variant. Omit when not needed. */
    avatar?: unknown;
};

/** A native chat row containing optional sender/time/avatar metadata and child content. */
@Component()
export class Message extends Cossack {
    declare props: MessageProps;

    render() {
        const { name, time, datetime, variant = "received", avatar, ...rest } = this.props;
        if (!['sent', 'received'].includes(variant)) throw new Error('Message variant must be sent or received.');
        if ([name, time].some(value => value !== undefined && typeof value !== 'string')) throw new Error('Message name and time must be strings.');
        if (datetime !== undefined && (typeof datetime !== 'string' || !datetime.trim() || !time?.trim())) throw new Error('Message datetime requires nonempty time and datetime strings.');
        const sent = variant === 'sent';
        return html`
            <div class=${classMap({
                'cs-message flex gap-2.5 w-full min-w-0': true,
                'cs-message--sent flex-row-reverse': sent,
                'cs-message--received': !sent,
            })} ...=${rest}>
                ${avatar != null ? html`<div class="cs-message__avatar shrink-0 self-end">${avatar}</div>` : null}
                <div class=${classMap({
                    'cs-message__body flex flex-col gap-1 w-full min-w-0 max-w-[80%] [--cs-bubble-max-width:100%]': true,
                    'items-end': sent,
                    'items-start': !sent,
                })}>
                    ${name || time ? html`<div class=${classMap({
                        'cs-message__meta flex flex-wrap items-center gap-2 px-1 min-w-0 max-w-full [overflow-wrap:anywhere]': true,
                        'justify-end': sent,
                    })}>
                        ${name ? html`<span class="cs-message__name text-xs font-medium text-foreground min-w-0">${name}</span>` : null}
                        ${time ? html`<span class="cs-message__time text-xs text-muted-foreground min-w-0">
                            ${datetime ? html`<time datetime=${datetime}>${time}</time>` : html`<span>${time}</span>`}
                        </span>` : null}
                    </div>` : null}
                    ${this.children}
                </div>
            </div>
        `;
    }
}
