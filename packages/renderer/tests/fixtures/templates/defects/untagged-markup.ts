// COSSACK_TEMPLATE_UNTAGGED_MARKUP: markup without the html tag renders as text.
import { html } from '@cossackframework/renderer';

export const view = (items: string[]) => html`<ul>${items.map((item) =>
  `<li>${item}</li>`)}</ul>`; // defect
