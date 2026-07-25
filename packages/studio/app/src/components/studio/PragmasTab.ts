import { Component, Cossack, Shared } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button, Input, Select, Switch } from '@cossackframework/ui';
import type { StudioPragma, StudioSchema } from '../../../../src/lib/schema-types';

interface PragmasTabProps {
  schema: StudioSchema;
  pragmas: StudioPragma[];
  drafts: Record<string, string>;
  active: boolean;
  loading: boolean;
  saving: boolean;
  onDraftChange: (name: string, value: string) => void;
  onSave: (name: string) => void;
  [key: string]: unknown;
}

@Component()
export class PragmasTab extends Cossack {
  declare props: PragmasTabProps;

  render() {
    const supported = ['sqlite', 'libsql', 'd1-local', 'd1-remote']
      .includes(this.props.schema.connection.provider);
    if (!supported) {
      return html`
        <div
          class="${this.props.active ? 'grid' : 'hidden'} min-h-0 flex-1 place-items-center p-6"
          data-testid="pragmas-panel"
        >
          <div class="max-w-lg text-center">
            <h2 class="text-lg font-semibold">Pragmas are not available</h2>
            <p class="mt-2 text-sm text-muted-foreground">
              PRAGMA is a SQLite-family interface. PostgreSQL and MySQL expose their
              server settings through different commands and system views.
            </p>
          </div>
        </div>
      `;
    }

    return html`
      <div
        class="${this.props.active ? 'block' : 'hidden'} min-h-0 flex-1 overflow-auto p-5"
        data-testid="pragmas-panel"
      >
        <header class="mb-5">
          <h2 class="text-lg font-semibold">SQLite pragmas</h2>
          <p class="mt-1 max-w-3xl text-sm text-muted-foreground">
            Inspect and edit commonly used SQLite settings. Changes are applied immediately;
            whether they affect this connection or the database file depends on the setting.
          </p>
        </header>

        ${!this.props.pragmas.length && this.props.loading
          ? html`<p class="text-sm text-muted-foreground">Loading pragmas…</p>`
          : ''}
        ${!this.props.pragmas.length && !this.props.loading
          ? html`
              <div class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No editable pragmas were reported by this database.
              </div>
            `
          : html`
              <div class="overflow-hidden rounded-lg border">
                <table class="w-full text-sm" data-testid="pragmas-table">
                  <thead>
                    <tr class="border-b bg-muted/40 text-left">
                      <th class="w-52 p-3">Pragma</th>
                      <th class="p-3">Description</th>
                      <th class="w-64 p-3">Value</th>
                      <th class="w-24 p-3"><span class="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.props.pragmas.map((pragma) => this.renderPragma(pragma))}
                  </tbody>
                </table>
              </div>
            `}
      </div>
    `;
  }

  @Shared()
  private renderPragma(pragma: StudioPragma) {
    const value = this.props.drafts[pragma.name] ?? pragma.value;
    const changed = value !== pragma.value;
    return html`
      <tr class="border-b last:border-b-0" data-testid="pragma-${pragma.name}">
        <td class="p-3 align-top font-mono font-medium">${pragma.name}</td>
        <td class="p-3 align-top text-muted-foreground">${pragma.description}</td>
        <td class="p-3 align-top">
          ${pragma.kind === 'boolean'
            ? html`
                <div class="flex h-8 items-center gap-3">
                  ${component(Switch, {
                    checked: value === '1',
                    'aria-label': `${pragma.name} value`,
                    '@change': (event: InputEvent) => this.props.onDraftChange(
                      pragma.name,
                      (event.target as HTMLInputElement).checked ? '1' : '0',
                    ),
                  })}
                  <span class="text-xs text-muted-foreground">
                    ${value === '1' ? 'On' : 'Off'}
                  </span>
                </div>
              `
            : pragma.kind === 'number'
              ? component(Input, {
                  type: 'number',
                  size: 'sm',
                  '.value': value,
                  'aria-label': `${pragma.name} value`,
                  '@input': (event: InputEvent) => this.props.onDraftChange(
                    pragma.name,
                    (event.target as HTMLInputElement).value,
                  ),
                })
              : component(Select, {
                  size: 'sm',
                  '.value': value,
                  'aria-label': `${pragma.name} value`,
                  '@change': (event: InputEvent) => this.props.onDraftChange(
                    pragma.name,
                    (event.target as HTMLSelectElement).value,
                  ),
                }, html`
                  ${pragma.options?.map((option) => html`
                    <option value="${option.value}">${option.label}</option>
                  `)}
                `)}
        </td>
        <td class="p-3 text-right align-top">
          ${component(Button, {
            variant: changed ? 'default' : 'outline',
            size: 'sm',
            disabled: Boolean(!changed || this.props.saving),
            'data-testid': `apply-pragma-${pragma.name}`,
            '@click': () => this.props.onSave(pragma.name),
          }, this.props.saving ? 'Applying…' : 'Apply')}
        </td>
      </tr>
    `;
  }
}
