// COSSACK_TEMPLATE_UNKNOWN_PROP: a component tag attribute the props do not declare.
import { html } from '@cossackframework/renderer';
import { Counter } from '../components';

export const view = () => html`
  <${Counter} label="Count" colour="red" />`; // defect
