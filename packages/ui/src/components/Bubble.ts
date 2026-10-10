import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import type { GlobalAttributes } from "../native-attributes";

export interface BubbleReaction {
    /** Decorative emoji or icon character. */
    emoji: string;
    /** Localized text equivalent, for example "Like". */
    label: string;
    /** Nonnegative safe integer. Zero remains visible; omit for no count. */
    count?: number;
}

export type BubbleProps = GlobalAttributes<HTMLDivElement> & {
    variant?: "sent" | "received";
    shape?: "default" | "pill" | "square";
    /** Display text; without datetime this stays ordinary text. */
    time?: string;
    /** HTML machine-readable timestamp. Requires nonempty time text. */
    datetime?: string;
    /** Display-only reactions. Interactive reaction controls belong in child content. */
    reactions?: readonly BubbleReaction[];
    /** Accessible name for the reaction list. Defaults to "Reactions". */
    reactionsLabel?: string;
};

/** A display bubble with native child content, readable reactions and optional time metadata. */
@Component()
export class Bubble extends Cossack {
    declare props: BubbleProps;

    render() {
        const { variant = "received", shape = "default", time, datetime, reactions = [], reactionsLabel = 'Reactions', ...rest } = this.props;
        if (!['sent', 'received'].includes(variant)) throw new Error('Bubble variant must be sent or received.');
        if (!['default', 'pill', 'square'].includes(shape)) throw new Error('Bubble shape must be default, pill or square.');
        if (time !== undefined && typeof time !== 'string') throw new Error('Bubble time must be a string.');
        if (datetime !== undefined && (typeof datetime !== 'string' || !datetime.trim() || !time?.trim())) throw new Error('Bubble datetime requires nonempty time and datetime strings.');
        if (typeof reactionsLabel !== 'string' || !reactionsLabel.trim()) throw new Error('Bubble reactionsLabel must be nonempty.');
        if (!Array.isArray(reactions)) throw new Error('Bubble reactions must be an array.');
        for (const reaction of reactions) {
            if (!reaction || typeof reaction.emoji !== 'string' || !reaction.emoji.trim() || typeof reaction.label !== 'string' || !reaction.label.trim()) throw new Error('Bubble reactions require nonempty emoji and label strings.');
            if (reaction.count !== undefined && (!Number.isSafeInteger(reaction.count) || reaction.count < 0)) throw new Error('Bubble reaction counts must be nonnegative safe integers.');
        }
        const sent = variant === 'sent';
        return html`
            <div class=${classMap({
                'cs-bubble flex flex-col w-full min-w-0': true,
                'cs-bubble--sent items-end': sent,
                'cs-bubble--received items-start': !sent,
            })} ...=${rest}>
                <div class="cs-bubble__body flex flex-col w-fit min-w-0 max-w-[var(--cs-bubble-max-width,75%)]">
                    <div class=${classMap({
                        'cs-bubble__content w-full min-w-0 px-3.5 py-2 text-sm [overflow-wrap:anywhere]': true,
                        'rounded-2xl': shape === 'default',
                        'rounded-full': shape === 'pill',
                        'rounded-md': shape === 'square',
                        'bg-primary text-primary-foreground': sent,
                        'bg-muted text-foreground': !sent,
                        'rounded-ee-md': sent && shape === 'default',
                        'rounded-es-md': !sent && shape === 'default',
                    })}>${this.children}</div>
                    ${reactions.length ? html`<ul aria-label=${reactionsLabel} class=${classMap({
                        'cs-bubble__reactions flex flex-wrap gap-1 list-none p-0 mx-2 mt-1 mb-0 min-w-0': true,
                        'justify-end': sent,
                        'justify-start': !sent,
                    })}>${reactions.map(reaction => html`<li class="cs-bubble__reaction inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-popover border text-xs shadow-sm min-w-0 [overflow-wrap:anywhere]">
                        <span aria-hidden="true">${reaction.emoji}</span><span class="sr-only">${reaction.label} </span>
                        ${reaction.count !== undefined ? html`<span class="text-muted-foreground font-medium">${reaction.count}</span>` : null}
                    </li>`)}</ul>` : null}
                    ${time ? html`<div class=${classMap({ 'cs-bubble__time text-xs text-muted-foreground mt-1 px-1 [overflow-wrap:anywhere]': true, 'text-end': sent })}>
                        ${datetime ? html`<time datetime=${datetime}>${time}</time>` : html`<span>${time}</span>`}
                    </div>` : null}
                </div>
            </div>
        `;
    }
}
