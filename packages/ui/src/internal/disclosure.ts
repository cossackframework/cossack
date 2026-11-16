import { PreventDefaultResult, preventDefault, type ReactiveControllerHost } from '@cossackframework/renderer';
import type { GlobalAttributes, ButtonAttributes, ControlEvent } from '../native-attributes';

export type DisclosureTriggerProps = Omit<ButtonAttributes, 'id' | 'type' | 'role' | 'disabled' | '?disabled' | 'aria-expanded' | 'aria-controls' | 'popovertarget' | 'popovertargetaction'>;
export type DisclosurePanelProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'style' | 'inert' | '?inert' | 'hidden' | '?hidden' | 'aria-hidden' | '@beforematch'>;
export type DisclosureProps = Omit<GlobalAttributes<HTMLDivElement>, 'id'> & {
    id: string;
    open?: boolean;
    defaultOpen?: boolean;
    disabled?: boolean;
    /** Proposes the next open state. Controlled callers must update open. */
    onOpenChange?: (open: boolean) => unknown;
    triggerProps?: DisclosureTriggerProps;
    panelProps?: DisclosurePanelProps;
};
export function validateDisclosure(id: string, label: string) {
    if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('Disclosure requires a nonempty, whitespace-free id.');
    if (typeof label !== 'string' || !label.trim()) throw new Error('Disclosure requires nonempty trigger text.');
}
export function disclosureClick(supplied: DisclosureTriggerProps['@click'], toggle: () => void) {
    const listener: EventListener = event => {
        if (typeof supplied === 'function') supplied(event as ControlEvent<HTMLButtonElement, PointerEvent>);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
        if (!event.defaultPrevented) toggle();
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}
export function restoreDisclosureFocus(open: boolean, panel?: HTMLElement, trigger?: HTMLButtonElement) {
    if (!open && panel?.contains(panel.ownerDocument.activeElement) && trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus({ preventScroll: true });
}

/** The resting style also works during SSR, before any DOM measurements. */
export function disclosureStyle(open: boolean): string {
    return `height: ${open ? "auto" : "0"}; overflow: ${open ? "visible" : "hidden"};`;
}

/**
 * The closed panel's hidden attribute: find-in-page can still reveal it (the panel then fires
 * beforematch), except while disabled. Browsers without until-found treat it as plain hidden.
 */
export function disclosureHidden(open: boolean, disabled?: boolean): string | null {
    return open ? null : disabled ? "" : "until-found";
}

/** Share height animation without retaining a height clamp on open content. */
export class DisclosureController {
    private open?: boolean;
    private animation?: Animation;
    /** The hidden value a collapsing panel gets back when its animation ends. */
    private concealed: string | null = null;

    constructor(
        host: ReactiveControllerHost,
        private read: () => {
            open: boolean;
            wrapper: HTMLElement | undefined;
            content: HTMLElement | undefined;
        },
    ) {
        host.addController(this);
    }

    hostUpdated() {
        const { open, wrapper, content } = this.read();
        if (!wrapper || !content || open === this.open) return;

        // A closing panel's hidden attribute skips its content, which then measures and paints
        // as empty: it stays off until the collapse ends, which also restores it after a
        // find-in-page reveal the owner did not accept.
        const concealed = open ? null : wrapper.getAttribute("hidden") ?? this.concealed ?? "until-found";
        if (!open) wrapper.removeAttribute("hidden");

        // A running animation still overrides the newly rendered resting style.
        // Read its current height before cancelling to allow smooth reversals.
        const from = this.animation
            ? wrapper.getBoundingClientRect().height
            : this.open ? content.getBoundingClientRect().height : 0;
        const previous = this.open;
        this.cancel();
        this.open = open;
        this.concealed = concealed;
        wrapper.style.height = open ? "auto" : "0";
        wrapper.style.overflow = open ? "visible" : "hidden";

        const animated = previous !== undefined && typeof wrapper.animate === "function"
            && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const to = animated && open ? content.getBoundingClientRect().height : 0;
        if (!animated || from === to) {
            this.conceal(wrapper);
            return;
        }

        const animation = wrapper.animate([
            { height: `${from}px`, overflow: "hidden" },
            { height: `${to}px`, overflow: "hidden" },
        ], { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        this.animation = animation;
        animation.onfinish = () => {
            this.cancel();
            this.conceal(wrapper);
        };
    }

    /**
     * Find-in-page already removed the panel's hidden attribute: show it at rest, with no
     * opening animation, before the owner proposes the open state.
     */
    revealed() {
        const { wrapper } = this.read();
        this.cancel();
        this.open = true;
        this.concealed = null;
        if (!wrapper) return;
        wrapper.style.height = "auto";
        wrapper.style.overflow = "visible";
    }

    hostDisconnected() {
        const { wrapper } = this.read();
        this.cancel();
        if (wrapper) this.conceal(wrapper);
        this.open = undefined;
    }

    private conceal(wrapper: HTMLElement) {
        if (this.open === false && this.concealed !== null) wrapper.setAttribute("hidden", this.concealed);
        this.concealed = null;
    }

    private cancel() {
        if (!this.animation) return;
        this.animation.onfinish = null;
        this.animation.cancel();
        this.animation = undefined;
    }
}
