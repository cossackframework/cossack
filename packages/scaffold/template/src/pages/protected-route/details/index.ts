import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ProtectedDetailsPage extends Cossack {
  @State() name = '';

  async init() {
    this.name = this.user!.name || this.user!.email;
  }

  render() {
    return html`<main><h2>Account details</h2><p>Welcome, ${this.name}.</p></main>`;
  }
}
