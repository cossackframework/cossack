// COSSACK_TEMPLATE_EVENT_ATTRIBUTE: React-style listeners are not listeners.
import { html } from '@cossackframework/renderer';

export const view = (save: () => void) => html`
  <button onClick=${save}>Save</button>`; // defect
