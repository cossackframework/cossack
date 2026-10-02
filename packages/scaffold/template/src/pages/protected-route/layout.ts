import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { requireProtectedUser } from '../../middlewares/protected-route';

@Page({ transport: 'http', middlewares: [requireProtectedUser] })
export default class ProtectedRouteLayout extends Cossack {
  render() {
    return html`
      <section>
        <h1>Protected account</h1>
        <nav aria-label="Account example">
          <a href="/protected-route">Account</a>
          <a href="/protected-route/details">Account details</a>
          <a href="/">Home</a>
        </nav>
        ${this.children}
      </section>
    `;
  }
}
