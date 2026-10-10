import { Component, Cossack, Inject, Page } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { ScopedCounterService } from '../../../services/scoped-counter';

@Component({ transport: 'http' })
class NestedCounterReadout extends Cossack {
  @Inject(ScopedCounterService) private counter!: ScopedCounterService;

  render() {
    return html`<p data-testid="nested-service-count">${this.counter.formatCount()}</p>`;
  }
}

@Page({ transport: 'http' })
export default class ScopedSiblingPage extends Cossack {
  @Inject(ScopedCounterService) private counter!: ScopedCounterService;

  render() {
    return html`
      <main>
        <h2>Sibling page</h2>
        <p data-testid="page-service-count">${this.counter.formatCount()}</p>
        ${component(NestedCounterReadout)}
      </main>
    `;
  }
}
