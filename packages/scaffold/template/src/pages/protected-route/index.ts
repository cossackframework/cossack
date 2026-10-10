import { Client, ClientState, Cossack, Page, RpcError, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ProtectedAccountPage extends Cossack {
  @State() email = '';
  @ClientState() pending = false;
  @ClientState() failure = '';
  @ClientState() verified = '';

  async init() {
    // The layout guard runs before SSR and every RPC. Use the authenticated
    // request identity, never an email/user supplied in component state.
    this.email = this.user!.email;
  }

  @Server()
  verifyIdentity(): string {
    return `Authenticated account: ${this.user!.email}`;
  }

  @Client()
  async verify() {
    if (this.pending) return;
    this.pending = true;
    this.failure = '';
    this.verified = '';
    try {
      this.verified = await this.verifyIdentity();
    } catch (error) {
      this.failure = error instanceof RpcError && error.status === 401
        ? 'Your session ended. Sign in again.' : 'Could not verify your account. Try again.';
    } finally {
      this.pending = false;
    }
  }

  render() {
    return html`
      <main>
        <h2>Your account</h2>
        <p>Signed in as <strong>${this.email}</strong></p>
        <button type="button" @click=${this.verify} ?disabled=${this.pending}>
          ${this.pending ? 'Verifying…' : 'Verify session'}
        </button>
        ${this.verified ? html`<p role="status">${this.verified}</p>` : ''}
        ${this.failure ? html`<p role="alert">${this.failure} <a href="/auth/login">Sign in</a></p>` : ''}
      </main>
    `;
  }
}
