// COSSACK_TEMPLATE_UNKNOWN_ATTRIBUTE: a misspelled attribute renders silently.
import { html } from '@cossackframework/renderer';

export const view = () => html`
  <button colour="red">Save</button>`; // defect
