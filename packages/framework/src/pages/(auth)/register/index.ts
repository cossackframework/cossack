import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { Button } from '@/components/Button';

@Page({ transport: 'http' })
export default class RegisterPage extends Cossack {
  render() {
    return html`
      <h3 style="margin-bottom: 1rem;">Create Account</h3>
      <form>
        <div style="margin-bottom: 1rem;">
          <label style="display: block; margin-bottom: 0.5rem;">Full Name</label>
          <input type="text" style="width: 100%; padding: 0.5rem;" placeholder="John Doe" />
        </div>
        <div style="margin-bottom: 1rem;">
          <label style="display: block; margin-bottom: 0.5rem;">Email</label>
          <input type="email" style="width: 100%; padding: 0.5rem;" placeholder="user@example.com" />
        </div>
        <div style="margin-bottom: 1rem;">
          <label style="display: block; margin-bottom: 0.5rem;">Password</label>
          <input type="password" style="width: 100%; padding: 0.5rem;" />
        </div>
        ${Button({ type: 'button', style: 'width: 100%' }, 'Register')}
      </form>
      <p style="margin-top: 1rem; text-align: center;">
        Already have an account? <a href="/login">Login</a>
      </p>
    `;
  }
}
