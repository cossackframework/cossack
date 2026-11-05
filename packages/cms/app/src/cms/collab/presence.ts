/**
 * Presence as the dashboard draws it: avatars ringed in each editor's color, stacked with a
 * count past `max`, and a chip naming who is in a field or a block. Client-safe.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Avatar } from '@cossackframework/ui';
import type { Participant } from '@cossackframework/cms';

/** Someone to draw: a participant, or a peer. */
export interface Someone {
    readonly user: string;
    readonly name: string;
    readonly avatar: string | null;
    readonly color: string;
}

/** The same user once, by user ID. */
export function distinct<T extends Someone>(people: Iterable<T>): T[] {
    const seen = new Map<string, T>();
    for (const person of people) if (!seen.has(person.user)) seen.set(person.user, person);
    return [...seen.values()];
}

/** The tooltip and accessible name of a group. */
export function namesOf(people: readonly Someone[]): string {
    return people.map(person => person.name).join(', ');
}

/** Up to `max` avatars with their colors as rings, then "+N"; names on hover and for assistive technology. */
export function avatarStack(people: readonly Someone[], options: { size?: number; max?: number; label: string }): TemplateResult | null {
    const list = distinct(people);
    if (!list.length) return null;
    const size = options.size ?? 24;
    const max = options.max ?? 3;
    const shown = list.slice(0, max);
    const rest = list.length - shown.length;
    const names = namesOf(list);
    return html`<span class="inline-flex items-center" role="img" aria-label=${`${options.label}: ${names}`} title=${names} data-presence=${list.length}>
        ${shown.map((person, index) => html`<span class=${`inline-flex rounded-full bg-background ${index ? '-ml-1.5' : ''}`} style=${`box-shadow: 0 0 0 2px ${person.color}; z-index: ${shown.length - index}`} data-presence-user=${person.user}>
            ${component(Avatar, { src: person.avatar ?? undefined, alt: '', size })}</span>`)}
        ${rest > 0 ? html`<span class="-ml-1.5 inline-flex items-center justify-center rounded-full border border-border bg-muted px-1 text-[10px] font-medium text-foreground" style=${`min-width: ${size}px; height: ${size}px`}>+${rest}</span>` : null}
    </span>`;
}

/** A small chip in the editor's color, naming who is in a field or block. */
export function presenceChip(people: readonly Someone[], what: string): TemplateResult | null {
    const list = distinct(people);
    if (!list.length) return null;
    const first = list[0]!;
    const label = list.length === 1 ? `${first.name} ${what}` : `${first.name} +${list.length - 1} ${what}`;
    return html`<span class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none text-white" style=${`background: ${first.color}`} data-presence-chip=${list.map(person => person.user).join(' ')}>
        ${component(Avatar, { src: first.avatar ?? undefined, alt: '', size: 14 })}${label}</span>`;
}

/** The outline style of a control or block someone else is in. */
export function presenceOutline(people: readonly Someone[]): string {
    const first = distinct(people)[0];
    return first ? `box-shadow: 0 0 0 2px ${first.color}; border-radius: 0.5rem;` : '';
}

/** Participants on a layout tab: the tab's stack leaves the viewer out. */
export function onTab(participants: readonly Participant[], tab: string, self: string): Participant[] {
    return participants.filter(participant => participant.user !== self && participant.tabs.includes(tab));
}
