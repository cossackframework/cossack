import { Component, Cossack } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { HistoryIcon } from '@cossackframework/solar-icons/history';
import { PlayIcon } from '@cossackframework/solar-icons/play';
import { StarIcon } from '@cossackframework/solar-icons/star';
import { Badge, Button, Icon, Sheet } from '@cossackframework/ui';
import type { QueryHistoryEntry } from '../../studio-page';

interface QueryHistorySheetProps {
  open: boolean;
  connectionLabel: string;
  history: QueryHistoryEntry[];
  onClose: () => void;
  onClear: () => void;
  onToggleFavorite: (id: string) => void;
  onLoad: (entry: QueryHistoryEntry) => void;
  onRun: (entry: QueryHistoryEntry) => void;
  [key: string]: unknown;
}

@Component()
export class QueryHistorySheet extends Cossack {
  declare props: QueryHistorySheetProps;

  render() {
    const history = [...this.props.history].sort((left, right) =>
      Number(right.favorite) - Number(left.favorite) ||
      right.executedAt - left.executedAt);
    return component(Sheet, {
      open: this.props.open,
      side: 'right',
      size: 'min(36rem, 94vw)',
      onClose: this.props.onClose,
      'data-testid': 'query-history',
    }, html`
      <header class="flex shrink-0 items-start justify-between gap-4 border-b p-5">
        <div>
          <h2 class="font-semibold">Query history</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Stored only in this browser for ${this.props.connectionLabel}.
          </p>
        </div>
        ${component(Button, {
          variant: 'outline',
          size: 'sm',
          disabled: !history.some((entry) => !entry.favorite),
          '@click': this.props.onClear,
        }, 'Clear history')}
      </header>
      <div class="min-h-0 flex-1 overflow-auto p-4">
        ${history.length ? html`
          <div class="grid gap-3">
            ${history.map((entry) => html`
              <article class="rounded-lg border bg-card p-3" data-testid="query-history-entry">
                <div class="mb-2 flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    ${component(Badge, {
                      variant: entry.error ? 'destructive' : 'secondary',
                    }, entry.source === 'browse' ? 'Browse' : 'SQL')}
                    <span>${new Date(entry.executedAt).toLocaleString()}</span>
                    <span>${entry.durationMs.toFixed(1)} ms</span>
                  </div>
                  <button
                    type="button"
                    class="${entry.favorite ? 'text-warning' : 'text-muted-foreground'} rounded-md p-1.5 hover:bg-accent"
                    aria-label="${entry.favorite ? 'Remove from saved queries' : 'Save query'}"
                    @click="${() => this.props.onToggleFavorite(entry.id)}"
                  >
                    ${component(Icon, {
                      entry: StarIcon,
                      style: entry.favorite ? 'bold' : 'line',
                      size: 17,
                    })}
                  </button>
                </div>
                <pre class="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">${entry.statement}</pre>
                ${entry.error ? html`
                  <p class="mt-2 line-clamp-2 text-xs text-destructive">${entry.error}</p>
                ` : ''}
                <div class="mt-3 flex justify-end gap-2">
                  ${component(Button, {
                    variant: 'outline',
                    size: 'sm',
                    '@click': () => this.props.onLoad(entry),
                  }, 'Load')}
                  ${component(Button, {
                    size: 'sm',
                    class: 'gap-1.5',
                    '@click': () => this.props.onRun(entry),
                  }, html`${component(Icon, { entry: PlayIcon, size: 14 })}Run`)}
                </div>
              </article>
            `)}
          </div>
        ` : html`
          <div class="grid min-h-64 place-items-center rounded-lg border border-dashed p-6 text-center">
            <div>
              ${component(Icon, { entry: HistoryIcon, size: 28 })}
              <p class="mt-2 text-sm font-medium">No query history yet</p>
              <p class="mt-1 text-xs text-muted-foreground">
                Queries executed from Browse or SQL will appear here.
              </p>
            </div>
          </div>
        `}
      </div>
    `);
  }
}
