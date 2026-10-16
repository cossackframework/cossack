// COSSACK_TEMPLATE_ATTRIBUTE_TYPE: a string where the attribute takes a number.
import { html } from '@cossackframework/renderer';

export const view = (span: string) => html`<table><tr>
  <td colspan=${span}>A</td></tr></table>`; // defect
