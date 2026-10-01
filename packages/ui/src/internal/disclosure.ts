import type { ReactiveControllerHost } from "@cossackframework/renderer";

/** The resting style also works during SSR, before any DOM measurements. */
export function disclosureStyle(open: boolean): string {
    return `height: ${open ? "auto" : "0"}; overflow: ${open ? "visible" : "hidden"};`;
}

/** Share height animation without retaining a height clamp on open content. */
export class DisclosureController {
    private open?: boolean;
    private animation?: Animation;

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

        // A running animation still overrides the newly rendered resting style.
        // Read its current height before cancelling to allow smooth reversals.
        const from = this.animation
            ? wrapper.getBoundingClientRect().height
            : this.open ? content.getBoundingClientRect().height : 0;
        const previous = this.open;
        this.cancel();
        this.open = open;
        wrapper.style.overflow = open ? "visible" : "hidden";

        if (previous === undefined || typeof wrapper.animate !== "function"
            || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

        const to = open ? content.getBoundingClientRect().height : 0;
        if (from === to) return;

        const animation = wrapper.animate([
            { height: `${from}px`, overflow: "hidden" },
            { height: `${to}px`, overflow: "hidden" },
        ], { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        this.animation = animation;
        animation.onfinish = () => {
            this.cancel();
        };
    }

    hostDisconnected() {
        this.cancel();
        this.open = undefined;
    }

    private cancel() {
        if (!this.animation) return;
        this.animation.onfinish = null;
        this.animation.cancel();
        this.animation = undefined;
    }
}
