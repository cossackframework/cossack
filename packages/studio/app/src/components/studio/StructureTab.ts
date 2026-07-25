import { Component, Cossack } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { KeyIcon } from '@cossackframework/solar-icons/key';
import { Badge, Checkbox, Icon, Tooltip } from '@cossackframework/ui';
import type { StudioObject, StudioSchema } from '../../../../src/lib/schema-types';
import type { StudioTheme } from '../../theme.client';
import { CodeEditor } from '../CodeEditor';

export interface StructureTabProps {
  object?: StudioObject;
  schema: StudioSchema;
  theme: StudioTheme;
  active: boolean;
  [key: string]: unknown;
}

@Component()
export class StructureTab extends Cossack {
  declare props: StructureTabProps;

  render() {
    const { object, active } = this.props;
    if (!object) {
      return html`
        <div class="${active ? 'block' : 'hidden'} min-h-0 flex-1 p-6 text-muted-foreground">
          Select a database object.
        </div>
      `;
    }
    return html`
      <div class="${active ? 'block' : 'hidden'} min-h-0 flex-1 overflow-auto p-5">
        <table class="w-full text-sm" data-testid="structure-table">
          <thead><tr class="border-b text-left">
            <th class="p-2">Column</th><th class="p-2">Type</th><th class="p-2">Affinity</th>
            <th class="p-2 text-center">Nullable</th><th class="p-2">Default</th><th class="p-2">Key</th>
          </tr></thead>
          <tbody>${object.columns.map((column) => html`
            <tr class="border-b">
              <td class="p-2 font-medium">${column.name}</td>
              <td class="p-2 font-mono">${column.dataType || '—'}</td>
              <td class="p-2">${column.affinity}</td>
              <td class="p-2 text-center">${component(Checkbox, {
                checked: column.nullable,
                disabled: true,
                'aria-label': `${column.name} ${column.nullable ? 'is nullable' : 'is required'}`,
              })}</td>
              <td class="p-2 font-mono">${column.defaultValue ?? '—'}</td>
              <td class="p-2">
                ${column.primaryKeyPosition ? component(Tooltip, {
                  label: `Primary key position ${column.primaryKeyPosition}${column.autoIncrement ? ' · auto increment' : ''}`,
                }, html`
                  <span class="inline-flex items-center gap-1.5 text-primary">
                    ${component(Icon, { entry: KeyIcon, size: 16 })}
                    <span>PK ${column.primaryKeyPosition}${column.autoIncrement ? ' · auto' : ''}</span>
                  </span>
                `) : '—'}
              </td>
            </tr>
          `)}</tbody>
        </table>

        <section class="mt-6">
          <h3 class="mb-2 font-semibold">Row identity</h3>
          ${object.rowLocators.length ? html`
            <div class="flex flex-wrap gap-2" data-testid="row-locators">
              ${object.rowLocators.map((locator) => component(Badge, {
                variant: locator.kind === 'primary-key' ? 'default' : 'secondary',
              }, locator.kind === 'primary-key'
                ? `Primary key: ${locator.columns.join(', ')}`
                : locator.kind === 'unique-index'
                  ? `Unique index: ${locator.name}`
                  : locator.kind === 'sqlite-rowid'
                    ? `SQLite ${locator.source} fallback`
                    : 'PostgreSQL tableoid + ctid fallback'))}
            </div>
          ` : html`
            <p class="text-sm text-muted-foreground">${object.readOnlyReason}</p>
          `}
        </section>

        <section class="mt-6">
          <h3 class="mb-2 font-semibold">Foreign keys</h3>
          ${object.foreignKeys.length ? html`
            <table class="w-full text-sm" data-testid="foreign-key-table">
              <thead><tr class="border-b text-left">
                <th class="p-2">Name</th><th class="p-2">Columns</th>
                <th class="p-2">References</th><th class="p-2">On update</th>
                <th class="p-2">On delete</th>
              </tr></thead>
              <tbody>${object.foreignKeys.map((foreignKey) => html`
                <tr class="border-b">
                  <td class="p-2 font-mono">${foreignKey.name}</td>
                  <td class="p-2 font-mono">
                    ${foreignKey.columns.map((column) => column.column).join(', ')}
                  </td>
                  <td class="p-2 font-mono">
                    ${foreignKey.referencedTable}
                    (${foreignKey.columns.map((column) => column.referencedColumn).join(', ')})
                  </td>
                  <td class="p-2">${foreignKey.onUpdate ?? '—'}</td>
                  <td class="p-2">${foreignKey.onDelete ?? '—'}</td>
                </tr>
              `)}</tbody>
            </table>
          ` : html`<p class="text-sm text-muted-foreground">No foreign keys declared.</p>`}
        </section>

        <section class="mt-6">
          <h3 class="mb-2 font-semibold">Indexes</h3>
          ${object.indexes.length ? html`
            <table class="w-full text-sm" data-testid="index-table">
              <thead><tr class="border-b text-left">
                <th class="p-2">Name</th><th class="p-2">Columns</th>
                <th class="p-2">Unique</th><th class="p-2">Origin</th><th class="p-2">Partial</th>
              </tr></thead>
              <tbody>${object.indexes.map((index) => html`
                <tr class="border-b">
                  <td class="p-2 font-mono">${index.name}</td>
                  <td class="p-2 font-mono">${index.columns
                    .map((column) =>
                      `${column.name ?? '(expression)'}${column.descending ? ' DESC' : ''}`)
                    .join(', ')}</td>
                  <td class="p-2">${component(Checkbox, {
                    checked: index.unique,
                    disabled: true,
                  })}</td>
                  <td class="p-2">${index.origin}</td>
                  <td class="p-2">${component(Checkbox, {
                    checked: index.partial,
                    disabled: true,
                  })}</td>
                </tr>
              `)}</tbody>
            </table>
          ` : html`<p class="text-sm text-muted-foreground">No indexes declared.</p>`}
        </section>

        ${object.sql ? html`
          <section class="mt-6">
            <h3 class="mb-2 font-semibold">Definition</h3>
            ${component(CodeEditor, {
              class: 'h-[12rem]',
              value: object.sql,
              language: 'sql',
              theme: this.props.theme,
              schema: this.props.schema,
              enabled: active,
              readOnly: true,
              ariaLabel: `${object.name} SQL definition`,
              'data-testid': 'structure-sql',
            })}
          </section>
        ` : ''}
      </div>
    `;
  }
}
