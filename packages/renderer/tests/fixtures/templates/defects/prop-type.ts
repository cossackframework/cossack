// COSSACK_TEMPLATE_PROP_TYPE: a component prop with a value it does not take.
import { html } from '@cossackframework/renderer';
import { Card } from '../components';

export const view = () => html`
  <${Card} padding="huge">Body</${Card}>`; // defect
