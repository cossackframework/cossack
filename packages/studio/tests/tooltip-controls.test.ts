import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { BrowseTab } from '../app/src/components/studio/BrowseTab';
import { SqlConsole } from '../app/src/components/studio/SqlConsole';
import { StructureTab } from '../app/src/components/studio/StructureTab';
import type { StudioObject, StudioSchema } from '../src/lib/schema-types';
import type { TransportQueryResult } from '../src/lib/query-types';

const object: StudioObject = { name: 'odd table', kind: 'table', sql: null, editable: true, indexes: [], foreignKeys: [], rowLocators: [{ kind: 'primary-key', columns: ['id field'] }], columns: [{ name: 'id field', dataType: 'INTEGER', affinity: 'integer', declaredKind: 'number', nullable: false, defaultValue: null, primaryKeyPosition: 1, autoIncrement: false, hidden: false }] };
const schema: StudioSchema = { applicationName: 'Test', connection: { provider: 'sqlite', label: 'Test', remote: false }, objects: [object] };
const result: TransportQueryResult = { columns: ['id field'], rows: [{ 'id field': 1 }, { 'id field': 2 }], affectedRows: 0, durationMs: 0, truncated: false };
const noop = () => {};
function descriptions(output: string) {
    const ids = Array.from(output.matchAll(/id="([^"]+)" role="tooltip"/g), match => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(output).toContain(`aria-describedby="${id}"`);
    return ids;
}
it('gives repeated browse actions distinct descriptions linked to their native buttons', () => {
    const output = renderToString(component(BrowseTab, { object, active: true, schema, result, loadedObject: object.name, page: 1, pageSize: 25,
        selectedRows: [], customQuery: false, query: '', loading: false, loadFailed: false, showFilter: false, filters: [], sort: [],
        filterColumn: 'id field', filterOperator: 'eq', filterValue: '', theme: 'light', inlineEditor: null, relationExpansions: {},
        onToggleFilter: noop, onRemoveFilter: noop, onRunQuery: noop, onFilterColumnChange: noop, onFilterOperatorChange: noop,
        onFilterValueChange: noop, onApplyFilter: noop, onQueryChange: noop, onDeleteSelected: noop, onBatchUpdate: noop, onExport: noop,
        onClearSelection: noop, onToggleAllRows: noop, onToggleSort: noop, onToggleRow: noop, onBeginCellEdit: noop,
        onInlineValueChange: noop, onInlineKeydown: noop, onSaveInlineEditor: noop, onInlineModeChange: noop, onFollowForeignKey: noop,
        onToggleRelation: noop, onOpenRelation: noop, onEditRow: noop, onDeleteRow: noop, onPageSizeChange: noop, onPageChange: noop,
    }));
    const ids = descriptions(output);
    expect(ids).toContain('browse-export-0-tip');expect(ids).toContain('browse-export-1-tip');
    expect(ids).toContain('browse-delete-0-tip');expect(ids).toContain('browse-delete-1-tip');
});
it('keeps SQL descriptions stable while labels change with running state', () => {
    const props = { active: true, sql: 'SELECT 1', theme: 'light' as const, schema, output: 'results' as const, sqlResult: result, explainResult: result,
        explainJson: null, running: false, explaining: false, onSqlChange: noop, onRun: noop, onExplain: noop, onOpenHistory: noop, onOutputChange: noop };
    const before = descriptions(renderToString(component(SqlConsole, props)));
    const after = descriptions(renderToString(component(SqlConsole, { ...props, running: true, explaining: true })));
    expect(after).toEqual(before);
});
it('makes primary-key details focusable with whitespace-free description IDs', () => {
    const output = renderToString(component(StructureTab, { object, schema, theme: 'light', active: true }));
    expect(descriptions(output)).toContain('structure-odd%20table-id%20field-key-tip');
    expect(output).toContain('tabindex="0" aria-describedby="structure-odd%20table-id%20field-key-tip"');
});
