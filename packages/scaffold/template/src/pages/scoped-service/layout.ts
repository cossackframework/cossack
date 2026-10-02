import { Cossack, Inject, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { ScopedCounterService } from '../../services/scoped-counter';

@Page({ transport: 'http', services: [ScopedCounterService] })
export default class ScopedServiceLayout extends Cossack {
  @Inject(ScopedCounterService) private counter!: ScopedCounterService;

  render() {
    return html`
      <section>
        <h1>Layout-scoped service</h1>
        <p>The count is shared within this browser layout. Leaving the layout or reloading resets it. No database is used.</p>
        <p data-testid="layout-service-count">${this.counter.formatCount()}</p>
        <nav aria-label="Service example">
          <a href="/scoped-service">Counter page</a>
          <a href="/scoped-service/other">Sibling page</a>
          <a href="/">Leave the layout</a>
        </nav>
        ${this.children}
      </section>
    `;
  }
}
