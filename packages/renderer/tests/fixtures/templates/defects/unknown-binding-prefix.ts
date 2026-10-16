// COSSACK_TEMPLATE_UNKNOWN_BINDING_PREFIX: a Vue-style binding.
import { html } from '@cossackframework/renderer';

export const view = (value: string) => html`
  <input :value=${value}>`; // defect
