// COSSACK_TEMPLATE_PROP_TYPE: text attributes pass strings, not numbers.
import { html } from '@cossackframework/renderer';
import { Counter } from '../components';

export const view = () => html`
  <${Counter} label="Count" count="3" />`; // defect
