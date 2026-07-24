import { Cossack, Page, type HeadContext, type HeadValue } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Badge, Card, Icon, Typography } from '@cossackframework/ui';
import { ArrowRightIcon } from '@cossackframework/solar-icons/arrow-right';
import { demoCatalog } from '../../demo-catalog.js';

@Page({ transport: 'http' })
export default class DemoOverview extends Cossack {
  head(_context: HeadContext): HeadValue {
    return {
      title: 'Demo overview',
      description: 'Explore the Cossack Framework feature demos.',
    };
  }

  render() {
    return html`
      <section class="space-y-10" data-testid="demo-overview">
        <div class="space-y-3">
          ${component(Badge, { variant: 'secondary' }, 'Framework showcase')}
          ${component(Typography, { variant: 'h1' }, 'Cossack Framework demos')}
          ${component(Typography, { variant: 'lead' },
            'Explore the framework through focused examples. Use the sidebar or press Ctrl/Cmd+K to jump anywhere.')}
        </div>

        ${demoCatalog.map((group) => html`
          <section class="space-y-4" data-demo-category="${group.category}">
            <div class="flex items-center gap-3">
              ${group.icon ? component(Icon, { entry: group.icon, size: 22 }) : null}
              ${component(Typography, { variant: 'h2' }, group.category)}
            </div>
            <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              ${group.entries.map((entry) => html`
                <a href="${entry.url}" class="block text-inherit no-underline" data-demo-url="${entry.url}">
                  ${component(Card, { interactive: true, class: 'flex h-full items-center justify-between gap-4' }, html`
                    <div>
                      <h3 class="font-semibold">${entry.label}</h3>
                      <p class="mt-1 text-sm text-muted-foreground">${entry.url}</p>
                    </div>
                    <span class="shrink-0 text-muted-foreground">
                      ${component(Icon, { entry: ArrowRightIcon, size: 18 })}
                    </span>
                  `)}
                </a>
              `)}
            </div>
          </section>
        `)}
      </section>
    `;
  }
}
