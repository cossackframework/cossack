// COSSACK_TEMPLATE_MISSING_PROP: a required prop is not set.
import { html } from '@cossackframework/renderer';
import { Counter } from '../components';

export const view = () => html`
  <${Counter} count=${1} />`; // defect
