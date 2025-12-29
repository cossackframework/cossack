import { Cossack, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class RootLayout extends Cossack {
  render(children: TemplateResult) {
    return html`
      <div class="root-layout">
        <header style="padding: 1rem; border-bottom: 1px solid #ccc;">
          <strong>Cossack Framework</strong>
          <nav style="display: inline-block; margin-left: 2rem;">
            <a href="/">Home</a> | 
            <a href="/contact">Contact</a> | 
            <a href="/optimistic-counter">Optimistic</a>
          </nav>
        </header>
        <div style="padding: 2rem;">
          ${children}
        </div>
        <footer style="padding: 1rem; border-top: 1px solid #ccc; margin-top: 2rem; font-size: 0.8rem;">
          Built with Cossack
        </footer>
      </div>
    `;
  }
}
