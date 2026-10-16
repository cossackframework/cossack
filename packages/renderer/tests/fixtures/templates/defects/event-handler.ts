// COSSACK_TEMPLATE_EVENT_HANDLER: a keyboard handler bound to a click.
import { html } from '@cossackframework/renderer';

const onKey = (event: KeyboardEvent) => event.key;
export const view = () => html`
  <button @click=${onKey}>Save</button>`; // defect
