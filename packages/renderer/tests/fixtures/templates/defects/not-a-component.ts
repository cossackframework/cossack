// COSSACK_TEMPLATE_NOT_A_COMPONENT: a component tag needs a component class.
import { html } from '@cossackframework/renderer';

const tag = 'div';
export const view = () => html`
  <${tag}>Body</${tag}>`; // defect
