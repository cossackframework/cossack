import { DataTable, type DataTableColumn, type DataTableProps } from '@cossackframework/ui';
import { component } from '@cossackframework/renderer';
type Person = { id: string; name: string; age: number };
const columns: DataTableColumn<Person>[] = [
    { id:'name', header:'Name', key:'name', sortable:true },
    { id:'age', header:'Age', accessor: row => row.age, cell: row => row.age.toFixed(0) },
];
const props: DataTableProps<Person> = { rows:[], columns, getRowId: row => row.id, caption:'People',
    rowCount:0,state:{page:1,pageSize:10,filter:''},onStateChange: () => {} };
component(DataTable<Person>, props);
// @ts-expect-error Invalid row key.
const badKey: DataTableColumn<Person> = { id:'bad', header:'Bad', key:'missing' };
// @ts-expect-error Invalid accessor property.
const badAccessor: DataTableColumn<Person> = { id:'bad', header:'Bad', accessor: row => row.missing };
// @ts-expect-error An accessor and key cannot compete.
const ambiguous: DataTableColumn<Person> = { id:'bad', header:'Bad', key:'name', accessor: row => row.name };
void [badKey,badAccessor,ambiguous];
