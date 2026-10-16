// COSSACK_TEMPLATE_BOOLEAN_BINDING: ?attr takes a boolean, not text.
import { html } from '@cossackframework/renderer';

export const view = (reason: string) => html`
  <input ?disabled=${reason}>`; // defect
