import { Cossack, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class DocsLayout extends Cossack {
  render() {
    return html`
      <div class="docs-container flex min-h-screen">
        <aside class="w-62.5 bg-gray-50 p-8 border-r border-gray-200">
          <nav>
            <h3 class="mt-0">Docs</h3>
            <ul class="list-none p-0">
              <li><a href="/docs">Introduction</a></li>
              <li><a href="/docs/routing">Routing</a></li>
              <li><a href="/docs/state">State Management</a></li>
            </ul>
          </nav>
        </aside>
        <main class="flex-1 p-12 max-w-200">
          ${this.children}
        </main>
      </div>
    `;
  }
}
