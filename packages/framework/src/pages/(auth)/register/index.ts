import { Cossack, Page } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Button, Input, Label, Typography } from '@cossackframework/ui';

@Page({ transport: 'http' })
export default class RegisterPage extends Cossack {
  render() {
    return html`
      <div class="mb-4">${component(Typography, { variant: 'h3' }, 'Create account')}</div>
      <form>
        <div class="mb-4">
          ${component(Label, { for: 'register-name' }, 'Full name')}
          <div class="mt-2">${component(Input, { id: 'register-name', type: 'text', placeholder: 'John Doe' })}</div>
        </div>
        <div class="mb-4">
          ${component(Label, { for: 'register-email' }, 'Email')}
          <div class="mt-2">${component(Input, { id: 'register-email', type: 'email', placeholder: 'user@example.com' })}</div>
        </div>
        <div class="mb-4">
          ${component(Label, { for: 'register-password' }, 'Password')}
          <div class="mt-2">${component(Input, { id: 'register-password', type: 'password' })}</div>
        </div>
        <div class="[&>button]:w-full">${component(Button, { type: 'button' }, 'Register')}</div>
      </form>
      <p class="mt-4 text-center">
        Already have an account? <a href="/login">Login</a>
      </p>
    `;
  }
}
