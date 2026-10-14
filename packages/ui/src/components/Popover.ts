import { html } from "@cossackframework/renderer";
import { Cossack, Component, Client, createRef, type RefObject } from "@cossackframework/core";
import type { ButtonAttributes, GlobalAttributes } from "../native-attributes";

/** Native panel attributes/events. Its identity and popover mode belong to Popover. */
export type PopoverContentProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'aria-modal'>;
export type PopoverProps = Omit<ButtonAttributes, 'id' | 'type' | 'role' | 'popovertarget' | 'popovertargetaction' | 'aria-expanded' | 'aria-controls'> & {
    /** Stable, page-unique trigger ID. The content ID is `${id}-content`. */
    id: string;
    /** Noninteractive content inside the button. Supply a visible or ARIA name. */
    trigger?: unknown;
    side?: "top" | "bottom" | "left" | "right";
    /** Start/end follows the trigger's writing direction on the horizontal axis. */
    align?: "start" | "center" | "end";
    /** Attributes/events for the content div. Choose semantics appropriate to its content. */
    contentProps?: PopoverContentProps;
};

/** Native nonmodal auto popover. The browser owns toggling, light dismiss and focus. */
@Component()
export class Popover extends Cossack {
    declare props: PopoverProps;
    popoverRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();
    private button?: HTMLButtonElement;
    private cleanup?: () => void;

    render() {
        const { id, trigger, side = 'top', align = 'center', contentProps = {}, ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('Popover requires a nonempty, whitespace-free id.');
        if (!['top','bottom','left','right'].includes(side)) throw new Error('Popover side must be top, bottom, left or right.');
        if (!['start','center','end'].includes(align)) throw new Error('Popover align must be start, center or end.');
        return html`<span class="cs-popover__wrapper relative inline-flex">
            <button ref=${(element: Element) => { this.button = element as HTMLButtonElement; }} id=${id} type="button"
                popovertarget=${`${id}-content`} popovertargetaction="toggle"
                class="cs-popover__trigger inline-flex items-center justify-center cursor-pointer outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-md disabled:opacity-50 disabled:cursor-not-allowed" ...=${rest}>${trigger}</button>
            <div ref=${(element: Element) => this.connect(element as HTMLDivElement)} id=${`${id}-content`} popover="auto"
                class="cs-popover bg-popover text-popover-foreground border rounded-lg shadow-lg p-4 outline-none" ...=${contentProps}>${this.children}</div>
        </span>`;
    }

    @Client()
    private connect(panel: HTMLDivElement) {
        if (this.popoverRef.value !== panel) {
            this.cleanup?.();
            this.popoverRef.value = panel;
            const document = panel.ownerDocument, window = document.defaultView;
            let active = true;
            const position = () => this.position();
            // This listener is separate from the supplied native @toggle callback.
            panel.addEventListener('toggle', position);
            document.addEventListener('scroll', position, true);
            window?.addEventListener('resize', position);
            window?.visualViewport?.addEventListener('resize', position);
            window?.visualViewport?.addEventListener('scroll', position);
            const resize = new ResizeObserver(position);
            resize.observe(panel);
            if (this.button) resize.observe(this.button);
            const disabled = new MutationObserver(() => { if (this.button?.matches(':disabled')) this.hide(); });
            const button = this.button;
            if (button) {
                disabled.observe(button, { attributes: true, attributeFilter: ['disabled'] });
                // Refs run before a client render adopts its nodes; walk ancestors once connected.
                queueMicrotask(() => {
                    if (!active) return;
                    for (let ancestor = button.parentElement; ancestor; ancestor = ancestor.parentElement) {
                        if (ancestor.tagName === 'FIELDSET') disabled.observe(ancestor, { attributes: true, attributeFilter: ['disabled'] });
                    }
                });
            }
            this.cleanup = () => {
                active = false;
                panel.removeEventListener('toggle', position);
                document.removeEventListener('scroll', position, true);
                window?.removeEventListener('resize', position);
                window?.visualViewport?.removeEventListener('resize', position);
                window?.visualViewport?.removeEventListener('scroll', position);
                resize.disconnect();
                disabled.disconnect();
                if (panel.isConnected && panel.matches(':popover-open')) panel.hidePopover();
            };
            queueMicrotask(() => { if (active && panel.isConnected) position(); });
        }
        queueMicrotask(() => {
            if (this.popoverRef.value !== panel || !panel.isConnected) return;
            if (this.button?.matches(':disabled')) this.hide();
            else this.position();
        });
    }

    @Client()
    show() {
        const panel = this.popoverRef.value, button = this.button;
        if (!panel?.isConnected || !button?.isConnected || button.matches(':disabled')) return;
        if (!panel.matches(':popover-open')) panel.showPopover({ source: button });
        this.position();
    }
    @Client()
    hide() {
        const panel = this.popoverRef.value;
        if (panel?.isConnected && panel.matches(':popover-open')) panel.hidePopover();
    }
    @Client()
    toggle() {
        if (this.popoverRef.value?.matches(':popover-open')) this.hide();
        else this.show();
    }

    @Client()
    private position() {
        const panel = this.popoverRef.value, button = this.button, window = panel?.ownerDocument.defaultView;
        if (!panel?.isConnected || !button?.isConnected || !window || !panel.matches(':popover-open')) return;
        const viewport = window.visualViewport;
        const gap = 8, x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
        const vw = viewport?.width ?? window.innerWidth, vh = viewport?.height ?? window.innerHeight;
        panel.style.position = 'fixed';
        panel.style.margin = '0';
        panel.style.inset = 'auto';
        panel.style.boxSizing = 'border-box';
        panel.style.maxWidth = `${Math.max(0, vw - gap * 2)}px`;
        panel.style.maxHeight = `${Math.max(0, vh - gap * 2)}px`;
        panel.style.overflow = 'auto';
        const rect = button.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight;
        let side = this.props.side ?? 'top';
        const align = this.props.align ?? 'center';
        const available = { top: rect.top - y - gap, bottom: y + vh - rect.bottom - gap, left: rect.left - x - gap, right: x + vw - rect.right - gap };
        const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
        const length = side === 'top' || side === 'bottom' ? height : width;
        if (available[side] < length && available[opposite[side]] > available[side]) side = opposite[side];
        const horizontal = side === 'top' || side === 'bottom';
        const rtl = window.getComputedStyle(button).direction === 'rtl';
        let left = side === 'left' ? rect.left - width - gap : rect.right + gap;
        let top = side === 'top' ? rect.top - height - gap : rect.bottom + gap;
        if (horizontal) {
            const start = rtl ? rect.right - width : rect.left, end = rtl ? rect.left : rect.right - width;
            left = align === 'start' ? start : align === 'end' ? end : rect.left + (rect.width - width) / 2;
        } else top = align === 'start' ? rect.top : align === 'end' ? rect.bottom - height : rect.top + (rect.height - height) / 2;
        panel.style.left = `${Math.max(x + gap, Math.min(left, x + vw - width - gap))}px`;
        panel.style.top = `${Math.max(y + gap, Math.min(top, y + vh - height - gap))}px`;
        panel.dataset.side = side;
    }

    onCleanup() {
        this.cleanup?.();
        this.cleanup = undefined;
        this.popoverRef.value = undefined;
        this.button = undefined;
    }
}
