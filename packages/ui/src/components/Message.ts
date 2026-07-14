import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface MessageProps {
    /** Sender display name (shown above received bubbles). */
    name?: string;
    /** Timestamp shown next to the name. */
    time?: string;
    /** Which side the message appears on. */
    variant?: "sent" | "received";
    /** Avatar element (pass a component(Avatar, {...})). Hidden when omitted. */
    avatar?: unknown;
    [key: string]: any;
}

/**
 * Cossack UI Message — chat message wrapper (avatar + bubble + metadata).
 *
 * Groups an avatar, sender name, and a Bubble into a complete chat row.
 * For "sent" messages the avatar/name are omitted (right-aligned).
 *
 *   ${component(Message, {
 *       name: 'Alice',
 *       time: '10:32 AM',
 *       variant: 'received',
 *       avatar: component(Avatar, { src: '/alice.png', size: 32 }),
 *   }, component(Bubble, { variant: 'received' }, 'Hello!'))}
 */
@Component()
export class Message extends Cossack {
    declare props: MessageProps;

    render() {
        const { name, time, variant = "received", avatar } = this.props;
        const isSent = variant === "sent";

        return html`
            <div class=${classMap({
                "cs-message": true,
                "cs-message--sent": isSent,
                "cs-message--received": !isSent,
                "flex gap-2.5": true,
                "flex-row-reverse": isSent,
            })}>
                ${avatar != null && !isSent
                    ? html`<div class="cs-message__avatar shrink-0 self-end">${avatar}</div>`
                    : null}
                <div class=${classMap({
                    "cs-message__body": true,
                    "flex flex-col gap-1": true,
                    "items-end": isSent,
                    "items-start": !isSent,
                    "max-w-[80%]": true,
                })}>
                    ${(name || time) && !isSent
                        ? html`<div class="cs-message__meta flex items-center gap-2 px-1">
                              ${name ? html`<span class="text-xs font-medium text-foreground">${name}</span>` : null}
                              ${time ? html`<span class="text-xs text-muted-foreground">${time}</span>` : null}
                          </div>`
                        : null}
                    ${this.children}
                </div>
            </div>
        `;
    }
}
