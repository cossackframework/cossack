import { Client, ClientState, Cossack, Inject, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { ScopedCounterService } from '../../services/scoped-counter';

@Page({ transport: 'http' })
export default class ScopedServicePage extends Cossack {
  @Inject(ScopedCounterService) private counter!: ScopedCounterService;
  @ClientState() pending = false;
  @ClientState() failure = '';
  @ClientState() acknowledgment = '';

  @Client()
  async increment() {
    if (this.pending) return;
    this.pending = true;
    this.failure = '';
    this.acknowledgment = '';
    try {
      this.acknowledgment = await this.counter.increment();
    } catch {
      this.failure = 'Could not update the counter. Try again.';
    } finally {
      this.pending = false;
    }
  }

  render() {
    return html`
      <main>
        <h2>Counter page</h2>
        <p data-testid="page-service-count">${this.counter.formatCount()}</p>
        <button type="button" @click=${this.increment} ?disabled=${this.pending}>
          ${this.pending ? 'Updating…' : 'Increment'}
        </button>
        ${this.failure ? html`<p role="alert">${this.failure}</p>` : ''}
        ${this.acknowledgment ? html`<p role="status">${this.acknowledgment}</p>` : ''}
      </main>
    `;
  }
}
