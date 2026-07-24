import { Cossack, Page } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Separator, Typography } from '@cossackframework/ui';

@Page({ transport: 'http' })
export default class DocsLayout extends Cossack {
  render() {
    return html`
      <div class="docs-container grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside class="rounded-lg border bg-card p-5">
          <nav>
            ${component(Typography, { variant: 'h3' }, 'Docs')}
            <div class="my-4">${component(Separator, {})}</div>
            <ul class="space-y-2 p-0">
              <li><a href="/docs">Introduction</a></li>
              <li><a href="/docs/hello">Hello guide</a></li>
            </ul>
          </nav>
        </aside>
        <main class="mdx-content min-w-0 max-w-4xl">
          ${this.children}
        </main>
      </div>
    `;
  }
}
