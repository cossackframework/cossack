import { html } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';

export type ButtonGroupProps = Omit<GlobalAttributes<HTMLDivElement>, 'role' | 'aria-label' | 'aria-labelledby' | 'tabindex'> & {
    /** Accessible group name. Children retain their own names and behavior. */
    label: string;
    orientation?: 'horizontal' | 'vertical';
    'data-orientation'?: never;
};

/** Named visual group of direct native buttons/links; no toolbar or selection behavior. */
@Component()
export class ButtonGroup extends Cossack {
    declare props: ButtonGroupProps;
    render() {
        const { orientation = 'horizontal', label, ...rest } = this.props;
        if (!['horizontal', 'vertical'].includes(orientation) || typeof label !== 'string' || !label.trim()) throw new Error('ButtonGroup requires a nonempty label and horizontal/vertical orientation.');
        return html`<div class="cs-button-group inline-flex isolate" role="group" aria-label=${label} data-orientation=${orientation} ...=${rest}>${this.children}</div>`;
    }
}
