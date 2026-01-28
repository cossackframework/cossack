import { Cossack, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ContactLayout extends Cossack {
  render() {
    return html`
      <div class="contact-layout" style="background: #f9f9f9; padding: 1rem; border-radius: 8px;">
        <h2 style="color: #3b82f6;">Contact Section</h2>
        ${this.children}
      </div>
    `;
  }
}
