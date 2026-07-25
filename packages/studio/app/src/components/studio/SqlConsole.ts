import { Component, Cossack } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { GraphIcon } from '@cossackframework/solar-icons/graph';
import { HistoryIcon } from '@cossackframework/solar-icons/history';
import { PlayIcon } from '@cossackframework/solar-icons/play';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import { Button, Icon, Tooltip } from '@cossackframework/ui';
import type { StudioSchema } from '../../../../src/lib/schema-types';
import type { TransportQueryResult } from '../../../../src/lib/query-types';
import { displayValue } from '../../studio-page';
import type { StudioTheme } from '../../theme.client';
import { CodeEditor } from '../CodeEditor';

type SqlOutput = 'results' | 'explain';

interface SqlConsoleProps {
  active: boolean;
  sql: string;
  theme: StudioTheme;
  schema: StudioSchema;
  output: SqlOutput;
  sqlResult: TransportQueryResult;
  explainResult: TransportQueryResult;
  explainJson: string | null;
  running: boolean;
  explaining: boolean;
  onSqlChange: (value: string) => void;
  onRun: () => void;
  onExplain: () => void;
  onOpenHistory: () => void;
  onOutputChange: (output: SqlOutput) => void;
  [key: string]: unknown;
}

function iconButton(
  icon: IconEntry,
  label: string,
  onClick: () => unknown,
  options: Record<string, unknown> = {},
) {
  return component(Tooltip, { label, side: 'bottom' }, component(Button, {
    variant: 'ghost',
    size: 'icon',
    'aria-label': label,
    title: label,
    '@click': onClick,
    ...options,
  }, component(Icon, { entry: icon, size: 17 })));
}

@Component()
export class SqlConsole extends Cossack {
  declare props: SqlConsoleProps;

  render() {
    const result = this.props.output === 'explain'
      ? this.props.explainResult
      : this.props.sqlResult;
    return html`
      <div class="${this.props.active ? 'grid' : 'hidden'} min-h-0 flex-1 grid-rows-[17rem_minmax(0,1fr)]">
        <div class="border-b bg-muted/20 p-4">
          ${component(CodeEditor, {
            class: 'h-[13rem]',
            value: this.props.sql,
            language: 'sql',
            theme: this.props.theme,
            schema: this.props.schema,
            enabled: this.props.active,
            ariaLabel: 'SQL statement',
            'data-testid': 'sql-editor',
            onChange: this.props.onSqlChange,
            onRun: this.props.onRun,
          })}
          <div class="mt-2 flex items-center justify-between">
            <span class="text-xs text-muted-foreground">
              Ctrl/Cmd+Enter to execute · schema-aware completion is cached in browser memory
            </span>
            <div class="flex items-center gap-1">
              ${iconButton(HistoryIcon, 'Query history', this.props.onOpenHistory, {
                'data-testid': 'open-query-history',
              })}
              ${iconButton(
                GraphIcon,
                this.props.explaining ? 'Generating query plan' : 'Explain query',
                this.props.onExplain,
                {
                  disabled: Boolean(this.props.explaining || !this.props.sql.trim()),
                  'data-testid': 'explain-sql',
                  variant: this.props.output === 'explain' ? 'secondary' : 'ghost',
                },
              )}
              ${iconButton(
                PlayIcon,
                this.props.running ? 'Running SQL' : 'Run SQL',
                this.props.onRun,
                {
                  disabled: this.props.running,
                  'data-testid': 'run-sql',
                  variant: 'default',
                },
              )}
            </div>
          </div>
        </div>
        <div class="flex min-h-0 flex-col overflow-hidden">
          <div class="flex h-10 shrink-0 items-center gap-1 border-b px-3">
            ${component(Button, {
              variant: this.props.output === 'results' ? 'secondary' : 'ghost',
              size: 'sm',
              'data-testid': 'sql-output-results',
              '@click': () => this.props.onOutputChange('results'),
            }, 'Results')}
            ${component(Button, {
              variant: this.props.output === 'explain' ? 'secondary' : 'ghost',
              size: 'sm',
              'data-testid': 'sql-output-explain',
              '@click': () => this.props.onOutputChange('explain'),
            }, 'Explain')}
          </div>
          <div class="min-h-0 flex-1 overflow-auto">
            ${this.props.output === 'explain' && this.props.explainJson
              ? component(CodeEditor, {
                  class: 'h-full min-h-[14rem] rounded-none border-0',
                  value: this.props.explainJson,
                  language: 'json',
                  theme: this.props.theme,
                  enabled: this.props.active,
                  readOnly: true,
                  ariaLabel: 'JSON query plan',
                  'data-testid': 'explain-json',
                })
              : html`
                  <table
                    class="w-full text-sm"
                    data-testid="${this.props.output === 'explain'
                      ? 'explain-results'
                      : 'sql-results'}"
                  >
                    <thead class="sticky top-0 bg-muted"><tr>
                      ${result.columns.map((column) => html`
                        <th class="border-b border-r p-2 text-left">${column}</th>
                      `)}
                    </tr></thead>
                    <tbody>${result.rows.map((row) => html`<tr>
                      ${result.columns.map((column) => html`
                        <td class="border-b border-r p-2 font-mono">
                          ${displayValue(row[column])}
                        </td>
                      `)}
                    </tr>`)}</tbody>
                  </table>
                `}
            <div class="p-3 text-xs text-muted-foreground">
              ${this.props.output === 'explain'
                ? `Plan generated in ${result.durationMs.toFixed(1)} ms`
                : `${result.affectedRows} affected row(s) · ${result.durationMs.toFixed(1)} ms`}
              ${result.truncated ? ' · Results truncated at 1,000 rows' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
