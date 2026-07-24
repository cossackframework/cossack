import { Cossack, Page } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Button, Input, Label, Typography } from '@cossackframework/ui';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
  render() {
    return html`
      <div class="mb-4">${component(Typography, { variant: 'h3' }, 'Login')}</div>
      <form>
        <div class="mb-4">
          ${component(Label, { for: 'login-email' }, 'Email')}
          <div class="mt-2">${component(Input, { id: 'login-email', type: 'email', placeholder: 'user@example.com' })}</div>
        </div>
        <div class="mb-4">
          ${component(Label, { for: 'login-password' }, 'Password')}
          <div class="mt-2">${component(Input, { id: 'login-password', type: 'password' })}</div>
        </div>
        <div class="[&>button]:w-full">${component(Button, { type: 'button' }, 'Sign In')}</div>
      </form>
      <p class="mt-4 text-center">
        Don't have an account? <a href="/register">Register</a>
      </p>
    `;
  }
}
