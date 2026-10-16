// COSSACK_TEMPLATE_DROPPED_BINDING: a binding in a tag outside an attribute value.
import { html } from '@cossackframework/renderer';

export const view = (attributes: string) => html`
  <div ${attributes}></div>`; // defect
