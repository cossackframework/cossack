import { Cossack, Page } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Card, Typography } from '@cossackframework/ui';

@Page({ transport: 'http' })
export default class ContactLayout extends Cossack {
  render() {
    return html`
      ${component(Card, { class: 'contact-layout' }, html`
        <div class="mb-4">${component(Typography, { variant: 'h2' }, 'Contact section')}</div>
        ${this.children}
      `)}
    `;
  }
}
