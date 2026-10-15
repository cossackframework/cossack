import { html } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';
import { HoverController, validateHover, type HoverSettings } from '../internal/hover';

export type TooltipProps = Omit<GlobalAttributes<HTMLSpanElement>, 'id'> & HoverSettings & {
    /** Stable tooltip ID. Reference it with aria-describedby on the actual trigger. */
    id: string;
    /** Plain descriptive text; never interactive content. */
    label: string;
};
/** Descriptive hover/focus text. Children own their accessible name and description reference. */
@Component()
export class Tooltip extends Cossack {
    declare props: TooltipProps;
    private wrapper?: HTMLSpanElement;
    private hover = new HoverController(() => this.props);
    render() {
        const { id, label, openDelay: _openDelay, closeDelay: _closeDelay, disabled: _disabled, side: _side, ...rest } = this.props;
        validateHover(id, this.props);
        if (typeof label !== 'string' || !label.trim()) throw new Error('Tooltip requires a nonempty label.');
        return html`<span ref=${(element: Element) => { this.wrapper = element as HTMLSpanElement; }} class="cs-tooltip relative inline-flex" ...=${rest}>
            ${this.children}
            <span ref=${(element: Element) => { if (this.wrapper) this.hover.attach(element as HTMLElement, this.wrapper); }} id=${id} role="tooltip" popover="manual"
                class="cs-tooltip__bubble px-2 py-1 text-xs rounded-md bg-foreground text-background whitespace-normal break-words">${label}</span>
        </span>`;
    }
    onCleanup() { this.hover.disconnect(); this.wrapper = undefined; }
}
