// COSSACK_TEMPLATE_PROPERTY_TYPE: a property bound to the wrong type.
import { html } from '@cossackframework/renderer';

export const view = (checked: string) => html`
  <input type="checkbox" .indeterminate=${checked}>`; // defect
