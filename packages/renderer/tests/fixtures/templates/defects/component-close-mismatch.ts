// COSSACK_TEMPLATE_COMPONENT_CLOSE_MISMATCH: the closing tag binds another class.
import { html } from '@cossackframework/renderer';
import { Button, Card } from '../components';

export const view = () => html`<${Card}>Body
  </${Button}>`; // defect
