import { expect, it, vi } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { DataTable, type DataTableProps } from '../src/components/DataTable';
type Row = { id: string; name: string };
function fixture(overrides: Partial<DataTableProps<Row>> = {}) {
    const table = new DataTable<Row>();
    table.props = { caption: 'People', rows: [{id:'a',name:'Alice'},{id:'b',name:'Bob'}],
        columns: [{id:'name',header:'Name',key:'name',sortable:true}], getRowId: row => row.id,
        rowCount: 8, state: {page:2,pageSize:2,filter:''}, onStateChange: vi.fn(),
        selection: new Set(['off-page']), onSelectionChange: vi.fn(), ...overrides };
    return table;
}
it('preserves off-page IDs and does not mutate the controlled selection', () => {
    const table = fixture(); const original = table.props.selection!;
    table.selectVisible(true);
    expect(table.props.onSelectionChange).toHaveBeenLastCalledWith(new Set(['off-page','a','b']));
    expect(original).toEqual(new Set(['off-page']));
    table.props.selection = new Set(['off-page','a','b']);
    table.selectVisible(false);
    expect(table.props.onSelectionChange).toHaveBeenLastCalledWith(new Set(['off-page']));
    table.props.rows = [{id:'c',name:'Carol'}]; table.selectRow('a',true);
    expect(table.props.onSelectionChange).toHaveBeenCalledTimes(2);
    table.selectRow('c',true);
    expect(table.props.onSelectionChange).toHaveBeenLastCalledWith(new Set(['off-page','a','b','c']));
});
it('excludes disabled rows and blocks selection during loading/errors', () => {
    const table = fixture({isRowSelectable: row => row.id !== 'b'});
    table.selectVisible(true);
    expect(table.props.onSelectionChange).toHaveBeenLastCalledWith(new Set(['off-page','a']));
    table.selectRow('b',true); table.props.loading=true; table.selectRow('a',true); table.selectVisible(true);
    table.props.loading=false;table.props.error='Request failed';table.selectVisible(false);
    expect(table.props.onSelectionChange).toHaveBeenCalledTimes(1);
});
it('cycles controlled sort and resets page without sorting the supplied rows', () => {
    const table=fixture(); const rows=table.props.rows;
    table.sortColumn('name');
    expect(table.props.onStateChange).toHaveBeenLastCalledWith({page:1,pageSize:2,filter:'',sort:{columnId:'name',direction:'asc'}});
    expect(table.props.state.page).toBe(2); expect(table.props.rows).toBe(rows);
    table.props.state.sort={columnId:'name',direction:'asc'};table.sortColumn('name');
    expect(table.props.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({sort:{columnId:'name',direction:'desc'}}));
    table.props.state.sort={columnId:'name',direction:'desc'};table.sortColumn('name');
    expect(table.props.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({sort:undefined}));
    table.sortColumn('missing');expect(table.props.onStateChange).toHaveBeenCalledTimes(3);
});
it('renders native table semantics, current filter, mixed selection and escaped cells', () => {
    const table=fixture({selection:new Set(['a']),rows:[{id:'a',name:'<script>x</script>'},{id:'b',name:'Bob'}],state:{page:1,pageSize:2,filter:'active'}});
    const output=renderToString(table.render());
    expect(output).toContain('<caption>People</caption>'); expect(output).toContain('scope="col"');
    expect(output).toContain('aria-checked="mixed"');expect(output).toContain('value="active"');
    expect(output).toContain('&lt;script&gt;');expect(output).not.toContain('<script>');
});
it('renders explicit loading, error and empty states', () => {
    const table=fixture({rows:[],rowCount:0,loading:true});
    expect(renderToString(table.render())).toContain('Loading rows');
    table.props.loading=false;table.props.error='Backend failed';table.props.onRetry=vi.fn();
    expect(renderToString(table.render())).toContain('role="alert"');expect(renderToString(table.render())).toContain('Retry');
    table.props.error=null;expect(renderToString(table.render())).toContain('No matching rows.');
});
it('rejects ambiguous identities and invalid controlled state', () => {
    expect(()=>fixture({rows:[{id:'same',name:'A'},{id:'same',name:'B'}]}).render()).toThrow(/row IDs/);
    expect(()=>fixture({columns:[{id:'a',header:'A',key:'name'},{id:'a',header:'B',key:'name'}]}).render()).toThrow(/column/);
    expect(()=>fixture({state:{page:0,pageSize:2,filter:''}}).render()).toThrow(/positive/);
    expect(()=>fixture({onSelectionChange:undefined}).render()).toThrow(/selection/);
});
