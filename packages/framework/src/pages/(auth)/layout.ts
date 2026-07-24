import { Cossack, Page } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Card, Typography } from '@cossackframework/ui';

@Page({ transport: 'http' })
export default class AuthLayout extends Cossack {
  render() {
    return html`
      <div class="auth-layout flex min-h-[70vh] items-center justify-center">
        ${component(Card, { class: 'w-full max-w-md' }, html`
          <div class="mb-6 text-center">
            ${component(Typography, { variant: 'h2' }, 'Cossack Auth')}
          </div>
          ${this.children}
          <div class="mt-6 text-center text-sm">
             <a href="/" class="text-muted-foreground hover:text-foreground">&larr; Back to overview</a>
          </div>
        `)}
      </div>
    `;
  }
}
