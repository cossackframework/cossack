import { Cossack, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ContactLayout extends Cossack {
  render() {
    return html`
      <div class="contact-layout bg-gray-50 p-4 rounded-lg">
        <h2 class="text-blue-500">Contact Section</h2>
        ${this.children}
      </div>
    `;
  }
}
