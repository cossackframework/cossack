import { Cossack, Page } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Button } from '@/components/Button';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
  render() {
    return html`
      <h3 class="mb-4">Login</h3>
      <form>
        <div class="mb-4">
          <label class="block mb-2">Email</label>
          <input type="email" class="w-full p-2" placeholder="user@example.com" />
        </div>
        <div class="mb-4">
          <label class="block mb-2">Password</label>
          <input type="password" class="w-full p-2" />
        </div>
        ${component(Button, { type: 'button', class: 'w-full' }, 'Sign In')}
      </form>
      <p class="mt-4 text-center">
        Don't have an account? <a href="/register">Register</a>
      </p>
    `;
  }
}
