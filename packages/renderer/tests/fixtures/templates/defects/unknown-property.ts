// COSSACK_TEMPLATE_UNKNOWN_PROPERTY: a misspelled property binding.
import { html } from '@cossackframework/renderer';

export const view = (value: string) => html`
  <input .valeu=${value}>`; // defect
