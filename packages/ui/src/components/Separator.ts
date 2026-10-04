import { html } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';

type SeparatorAttributes<Element extends HTMLElement> = Omit<GlobalAttributes<Element>, 'role' | 'tabindex' | 'aria-hidden' | 'aria-orientation' | 'aria-valuenow' | 'aria-valuemin' | 'aria-valuemax'>;
export type SeparatorProps = { decorative?: boolean } & (
    { orientation?: 'horizontal' } & SeparatorAttributes<HTMLHRElement> |
    { orientation: 'vertical' } & SeparatorAttributes<HTMLDivElement>
);

/** Static semantic or decorative divider; not a focusable splitter. */
@Component()
export class Separator extends Cossack {
    declare props: SeparatorProps;
    render() {
        const { orientation = 'horizontal', decorative = false, ...rest } = this.props;
        if (!['horizontal', 'vertical'].includes(orientation)) throw new Error('Separator orientation must be horizontal or vertical.');
        if (orientation === 'horizontal') return html`<hr class="cs-separator shrink-0 bg-border border-0 h-px w-full" aria-hidden=${decorative ? 'true' : undefined} ...=${rest}>`;
        return html`<div class="cs-separator cs-separator--vertical shrink-0 bg-border self-stretch w-px" role=${decorative ? undefined : 'separator'} aria-orientation=${decorative ? undefined : 'vertical'} aria-hidden=${decorative ? 'true' : undefined} ...=${rest}></div>`;
    }
}
