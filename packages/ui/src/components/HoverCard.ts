import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState, createRef, type RefObject } from "@cossackframework/core";

export interface HoverCardProps {
    /** Hover delay in ms before showing. Default 300. */
    delay?: number;
    [key: string]: any;
}

/**
 * Cossack UI HoverCard — content that appears on hover using native `popover`.
 *
 * The trigger is the children. The hover card content is passed via the `content` prop.
 * Uses a hover-intent delay to avoid accidental triggers.
 *
 *   ${component(HoverCard, {
 *       content: html\`<div>Hover details</div>\`,
 *   }, component(Button, {}, 'Hover me'))}
 */
@Component()
export class HoverCard extends Cossack {
    declare props: HoverCardProps;

    popoverRef: RefObject<HTMLElement> = createRef<HTMLElement>();
    private popoverId = `cs-hover-card-${Math.random().toString(36).slice(2, 9)}`;
    private hoverTimer: ReturnType<typeof setTimeout> | undefined;

    render() {
        const { content } = this.props;

        const popoverClasses = classMap({
            "cs-hover-card": true,
            "bg-background border border-border rounded-lg shadow-lg p-4 w-64": true,
        });

        return html`
            <span
                class="cs-hover-card__wrapper relative inline-flex"
                @mouseenter=${() => this.scheduleShow()}
                @mouseleave=${() => this.scheduleHide()}
                @focusin=${() => this.scheduleShow()}
                @focusout=${() => this.scheduleHide()}
            >
                <span
                    popovertarget=${this.popoverId}
                    class="cs-hover-card__trigger inline-flex"
                    tabindex="0"
                >${this.children}</span>
                <div
                    ref=${this.popoverRef}
                    id=${this.popoverId}
                    popover="manual"
                    class=${popoverClasses}
                    @mouseenter=${() => this.clearTimer()}
                    @mouseleave=${() => this.scheduleHide()}
                >${content}</div>
            </span>
        `;
    }

    @Client()
    private scheduleShow() {
        this.clearTimer();
        const delay = this.props.delay ?? 300;
        this.hoverTimer = setTimeout(() => this.show(), delay);
    }

    @Client()
    private scheduleHide() {
        this.clearTimer();
        this.hoverTimer = setTimeout(() => this.hide(), 100);
    }

    @Client()
    private clearTimer() {
        if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = undefined;
        }
    }

    @Client()
    show() {
        const el = this.popoverRef.value as any;
        el?.showPopover?.();
        this.position();
    }

    @Client()
    hide() {
        const el = this.popoverRef.value as any;
        el?.hidePopover?.();
    }

    @Client()
    private position() {
        const popover = this.popoverRef.value;
        if (!popover || !popover.matches(":popover-open")) return;
        const trigger = popover.closest(".cs-hover-card__wrapper")?.querySelector<HTMLElement>(".cs-hover-card__trigger");
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const gap = 8;
        popover.style.position = "fixed";
        popover.style.top = `${rect.bottom + gap}px`;
        popover.style.left = `${rect.left}px`;
        popover.style.margin = "0";
    }
}
