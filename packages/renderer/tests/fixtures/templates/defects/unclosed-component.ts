// COSSACK_TEMPLATE_UNCLOSED_COMPONENT: a component tag without its closing tag.
import { html } from '@cossackframework/renderer';
import { Card } from '../components';

export const view = () => html`<main>
  <${Card} padding="sm"></main>`; // defect
