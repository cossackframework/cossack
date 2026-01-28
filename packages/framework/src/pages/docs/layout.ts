import { Cossack, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class DocsLayout extends Cossack {
  render() {
    return html`
      <div class="docs-container" style="display: flex; min-height: 100vh;">
        <aside style="width: 250px; background: #f9f9f9; padding: 2rem; border-right: 1px solid #eee;">
          <nav>
            <h3 style="margin-top: 0;">Docs</h3>
            <ul style="list-style: none; padding: 0;">
              <li><a href="/docs">Introduction</a></li>
              <li><a href="/docs/routing">Routing</a></li>
              <li><a href="/docs/state">State Management</a></li>
            </ul>
          </nav>
        </aside>
        <main style="flex: 1; padding: 3rem; max-width: 800px;">
          ${this.children}
        </main>
      </div>
    `;
  }
}
