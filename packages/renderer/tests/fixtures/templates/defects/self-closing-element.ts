// COSSACK_TEMPLATE_SELF_CLOSING_ELEMENT: /> does not close an HTML element.
import { html } from '@cossackframework/renderer';

export const view = () => html`<section>
  <div class="spacer" /></section>`; // defect
