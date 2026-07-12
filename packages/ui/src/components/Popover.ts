import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    OnWindow,
    createRef,
    type RefObject,
} from "@cossackframework/core";

export interface PopoverProps {
    /** Trigger content (a label string or template). Rendered inside the button. */
    trigger?: unknown;
    /** Preferred position of the popover relative to the trigger. */
    side?: "top" | "bottom" | "left" | "right";
    /** Alignment of the popover relative to the trigger along the cross-axis. */
    align?: "start" | "center" | "end";
    /** Allow arbitrary HTML attributes to spread onto the trigger wrapper. */
    [key: string]: any;
}

/**
 * Cossack UI Popover — native top-layer popover via the `popover` attribute,
 * with JS-driven positioning anchored to the trigger.
 *
 * The native `popover` attribute gives top-layer rendering + light dismiss.
 * Because top-layer elements are positioned relative to the viewport (not their
 * DOM parent), we compute position from the trigger's `getBoundingClientRect()`
 * on open, on scroll, and on resize.
 *
 *   ${component(Popover, { trigger: 'Open', side: 'bottom' },
 *       html\`<p>Content</p>\`)}
 */
@Component()
export class Popover extends Cossack {
    declare props: PopoverProps;

    popoverRef: RefObject<HTMLElement> = createRef<HTMLElement>();
    private popoverId = `cs-popover-${Math.random().toString(36).slice(2, 9)}`;

    render() {
        const { trigger, side = "bottom", align = "center" } = this.props;

        const popoverClasses = classMap({
            "cs-popover": true,
            [`cs-popover--${side}`]: true,
            [`cs-popover--align-${align}`]: true,
            "bg-background border border-border rounded-lg shadow-lg p-4": true,
        });

        return html`
            <span class="cs-popover__wrapper relative inline-flex">
                <button
                    type="button"
                    popovertarget=${this.popoverId}
                    class="cs-popover__trigger inline-flex items-center justify-center cursor-pointer"
                    @click=${() => this.handleToggle()}
                >
                    ${trigger}
                </button>
                <div
                    ref=${this.popoverRef}
                    id=${this.popoverId}
                    popover="auto"
                    class=${popoverClasses}
                    @toggle=${(e: Event) => this.handleToggleEvent(e)}
                >
                    ${this.children}
                </div>
            </span>
        `;
    }

    private handleToggle() {
        // After the browser opens/closes the popover, position it.
        // Use rAF to wait for the top-layer element to be visible.
        requestAnimationFrame(() => this.position());
    }

    private handleToggleEvent(e: Event) {
        const el = e.target as HTMLElement;
        if (el.classList.contains("cs-popover") && el.matches(":popover-open")) {
            this.position();
        }
    }

    /** Reposition on scroll/resize while open. */
    @OnWindow("scroll", { throttle: 100 })
    @OnWindow("resize")
    onViewportChange() {
        const el = this.popoverRef.value;
        if (el && el.matches(":popover-open")) {
            this.position();
        }
    }

    @Client()
    show() {
        const el = this.popoverRef.value as any;
        el?.showPopover?.();
        requestAnimationFrame(() => this.position());
    }

    @Client()
    hide() {
        const el = this.popoverRef.value as any;
        el?.hidePopover?.();
    }

    @Client()
    toggle() {
        const el = this.popoverRef.value as any;
        el?.togglePopover?.();
        requestAnimationFrame(() => this.position());
    }

    /** Compute position from the trigger button's bounding rect. */
    private position() {
        const popover = this.popoverRef.value;
        if (!popover) return;
        const trigger = popover
            .closest(".cs-popover__wrapper")
            ?.querySelector<HTMLElement>(".cs-popover__trigger");
        if (!trigger) return;
        if (!popover.matches(":popover-open")) return;

        const rect = trigger.getBoundingClientRect();
        const side = this.props.side || "bottom";
        const align = this.props.align || "center";
        const gap = 8;
        const pw = popover.offsetWidth;
        const ph = popover.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let top = 0;
        let left = 0;

        // Primary axis (side)
        if (side === "bottom") top = rect.bottom + gap;
        else if (side === "top") top = rect.top - ph - gap;
        else if (side === "left") left = rect.left - pw - gap;
        else left = rect.right + gap; // right

        // Cross axis (align), depends on side
        if (side === "top" || side === "bottom") {
            if (align === "start") left = rect.left;
            else if (align === "end") left = rect.right - pw;
            else left = rect.left + rect.width / 2 - pw / 2; // center
            // default top was set above for bottom; set for top already
            if (side === "top") { /* top already set */ }
        } else {
            // left/right: cross axis is vertical
            if (align === "start") top = rect.top;
            else if (align === "end") top = rect.bottom - ph;
            else top = rect.top + rect.height / 2 - ph / 2;
            if (side === "left") { /* left already set */ }
        }

        // Collision detection: flip into viewport
        if (left < gap) left = gap;
        if (left + pw > vw - gap) left = vw - pw - gap;
        if (top < gap) top = gap;
        if (top + ph > vh - gap) top = vh - ph - gap;

        popover.style.position = "fixed";
        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
        popover.style.margin = "0";
    }
}
