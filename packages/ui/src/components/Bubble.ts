import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface BubbleReaction {
    /** The emoji or icon character. */
    emoji: string;
    /** Number of people who reacted. */
    count?: number;
}

export interface BubbleProps {
    /** Which side / sender the bubble represents. */
    variant?: "sent" | "received";
    /** Visual shape variant. */
    shape?: "default" | "pill" | "square";
    /** Optional timestamp shown below the bubble. */
    time?: string;
    /** Reaction badges shown overlapping the bubble's bottom edge. */
    reactions?: BubbleReaction[];
    [key: string]: any;
}

/**
 * Cossack UI Bubble — chat message bubble.
 *
 * Renders a message bubble aligned left (received) or right (sent) with
 * rounded corners and a tail. Use inside a `Message` wrapper for avatar +
 * metadata, or standalone for simple chat UIs.
 *
 *   ${component(Bubble, { variant: 'sent' }, 'Hello!')}
 *   ${component(Bubble, {
 *       variant: 'received',
 *       time: '10:32 AM',
 *       reactions: [{ emoji: '👍', count: 3 }, { emoji: '❤️' }],
 *   }, 'Hi there!')}
 */
@Component()
export class Bubble extends Cossack {
    declare props: BubbleProps;

    render() {
        const { variant = "received", shape = "default", time, reactions } = this.props;
        const isSent = variant === "sent";

        return html`
            <div class=${classMap({
                "cs-bubble": true,
                "cs-bubble--sent": isSent,
                "cs-bubble--received": !isSent,
                "flex flex-col": true,
                "items-end": isSent,
                "items-start": !isSent,
            })}>
                <div class="relative">
                    <div class=${classMap({
                        "cs-bubble__content": true,
                        "max-w-[75%] px-3.5 py-2 text-sm": true,
                        "rounded-2xl": shape === "default",
                        "rounded-full": shape === "pill",
                        "rounded-md": shape === "square",
                        // Sent: primary color, tail on bottom-right
                        "bg-primary text-primary-foreground rounded-br-md": isSent && shape === "default",
                        // Received: muted color, tail on bottom-left
                        "bg-muted text-foreground rounded-bl-md": !isSent && shape === "default",
                        "bg-primary text-primary-foreground": isSent && shape !== "default",
                        "bg-muted text-foreground": !isSent && shape !== "default",
                    })}>
                        ${this.children}
                    </div>
                    ${reactions && reactions.length
                        ? html`<div class=${classMap({
                              "cs-bubble__reactions absolute -bottom-2.5 flex items-center gap-0.5": true,
                              "left-2": !isSent,
                              "right-2": isSent,
                          })}>
                              ${reactions.map((r) => html`
                                  <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-background border border-border text-xs shadow-sm">
                                      <span>${r.emoji}</span>
                                      ${r.count ? html`<span class="text-muted-foreground font-medium">${r.count}</span>` : null}
                                  </span>
                              `)}
                          </div>`
                        : null}
                </div>
                ${time
                    ? html`<span class="cs-bubble__time text-xs text-muted-foreground mt-2 px-1">${time}</span>`
                    : null}
            </div>
        `;
    }
}
