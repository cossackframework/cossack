import { html } from '@cossackframework/renderer';
import { Cossack, Component, Client, createRef, type RefObject } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';
import { HoverController, validateHover, type HoverSettings } from '../internal/hover';

export type HoverCardProps = Omit<GlobalAttributes<HTMLDivElement>, 'id'> & HoverSettings & {
    /** Stable panel ID. Trigger children must be keyboard-focusable. */
    id: string;
    /** Accessible name for the nonmodal card. */
    label: string;
    content: unknown;
    contentProps?: Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role' | 'aria-modal' | 'aria-label'>;
};
/** Nonmodal hover/focus content without an extra wrapper tab stop. */
@Component()
export class HoverCard extends Cossack {
    declare props: HoverCardProps;
    popoverRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();
    private wrapper?: HTMLDivElement;
    private hover = new HoverController(() => ({ ...this.props, side: this.props.side ?? 'bottom' }));
    render() {
        const { id, label, content, contentProps = {}, delay: _delay, closeDelay: _close, disabled: _disabled, side: _side, ...rest } = this.props;
        validateHover(id, this.props);
        if (typeof label !== 'string' || !label.trim()) throw new Error('HoverCard requires a nonempty label.');
        return html`<div ref=${(element: Element) => { this.wrapper = element as HTMLDivElement; }} class="cs-hover-card__wrapper relative inline-flex" ...=${rest}>
            ${this.children}
            <div ref=${(element: Element) => { this.popoverRef.value = element as HTMLDivElement; if (this.wrapper) this.hover.attach(element as HTMLElement, this.wrapper); }}
                id=${id} role="dialog" aria-label=${label} popover="manual" class="cs-hover-card bg-popover text-popover-foreground border rounded-lg shadow-lg p-4 w-64 outline-none"
                ...=${contentProps}>${content}</div>
        </div>`;
    }
    @Client() show() { this.hover.show(true); }
    @Client() hide() { this.hover.hide(); }
    onCleanup() { this.hover.disconnect(); this.wrapper = undefined; this.popoverRef.value = undefined; }
}
