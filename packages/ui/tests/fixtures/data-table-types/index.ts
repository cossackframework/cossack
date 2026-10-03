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

import { Button, Input, Label, Checkbox, Switch, Form, type ButtonProps, type InputProps } from '@cossackframework/ui';
import { bind, live, ifDefined, preventDefault } from '@cossackframework/renderer';
const button: ButtonProps = { type:'submit', disabled:false, '?disabled':false, 'aria-label':'Save',
    'data-testid':'save', '@click': event => { event.currentTarget.disabled = true; event.preventDefault(); } };
component(Button, button, 'Save');
component(Input, {type:'email', required:true, autocomplete:'email', '.value':live('a@example.test'),
    '@input': event => { const value:string = event.currentTarget.value; void value; },
    '@keydown': event => { const key:string = event.key; void key; }, placeholder:ifDefined(undefined)});
component(Input, {'.value':bind({name:''},'name'), '@change':preventDefault(()=>{})});
component(Label, {for:'email', 'aria-hidden':false}, 'Email');
component(Checkbox, {checked:true, label:'Accept', '@change':event => { const value:boolean = event.currentTarget.checked; void value; }});
component(Switch, {checked:false, name:'enabled', 'aria-label':'Enabled'});
component(Form, {method:'post', submit:event => { const form:HTMLFormElement = event.currentTarget; void form; }});
// @ts-expect-error Misspelled native attribute cannot hide in an arbitrary index signature.
component(Input, {placehoder:'Name'});
// @ts-expect-error Closed component props must remain closed at composition.
component(DataTable<Person>, {...props, rowCont:4});
// @ts-expect-error Native boolean attributes reject strings.
component(Button, {disabled:'false'});
// @ts-expect-error Unknown event names are not listeners.
component(Button, {'@clik':()=>{}});
// @ts-expect-error React-style handler names are not renderer listeners.
component(Button, {onClick:()=>{}});
// @ts-expect-error A keyboard handler cannot handle a pointer click.
component(Button, {'@click':(event:KeyboardEvent)=>event.key});
// @ts-expect-error Input value is a string/number or supported property directive.
component(Input, {'.value':{arbitrary:true}});
// @ts-expect-error Native size and visual size are not interchangeable.
const invalidSize:InputProps = {size:10};
// @ts-expect-error Checkbox semantics cannot be changed through a type override.
component(Checkbox, {type:'text'});
// @ts-expect-error Controlled checked state has one owner.
component(Switch, {'.checked':true});
void invalidSize;
// @ts-expect-error ARIA reflection element properties are not HTML attributes.
component(Input, {'aria-controlselements':'other'});
// @ts-expect-error Unknown ARIA names must not silently become attributes.
component(Button, {'aria-labl':'Save'});
// @ts-expect-error Data attributes are scalar, not arbitrary application objects.
component(Input, {'data-record':{id:1}});

// @ts-expect-error Text-only attributes do not belong to checkbox controls.
component(Checkbox, {placeholder:'Ignored by native checkboxes'});

// @ts-expect-error A plain object with value is not an ifDefined directive.
component(Input, {'data-record':{value:1}});
// @ts-expect-error A plain object with value is not a live directive.
component(Input, {'.value':{value:'name'}});
// @ts-expect-error An object handler is not a preventDefault directive.
component(Button, {'@click':{handler:()=>{},novalidate:true}});

import { RadioGroup, Slider, type RadioGroupItem } from '@cossackframework/ui';
const choices:readonly RadioGroupItem[] = [{value:'free',label:'Free'}, {value:'pro',label:'Pro'}];
component(RadioGroup, {name:'plan',items:choices,required:true,disabled:false,form:'settings','aria-label':'Plan',
  onValueChange:(value,event)=>{ const input:HTMLInputElement=event.currentTarget; void [value,input]; },
  '@change':event=>{const group:HTMLDivElement=event.currentTarget;void group;}});
component(Slider, {value:1500,min:1000,max:2000,step:100,name:'level',label:'Level',
  '@input':event=>{const number:number=event.currentTarget.valueAsNumber;void number;}});
// @ts-expect-error Radio groups require a native group name.
component(RadioGroup, {items:choices});
// @ts-expect-error Radio values must be strings.
component(RadioGroup, {name:'plan',items:[{value:1}]});
// @ts-expect-error Group-level events target the group, not an input.
component(RadioGroup, {name:'plan','@change':event=>event.currentTarget.checked});
// @ts-expect-error Native input placeholder has no meaning on a group div.
component(RadioGroup, {name:'plan',placeholder:'Plan'});
// @ts-expect-error Slider bounds are numeric.
component(Slider, {min:'1000'});
// @ts-expect-error Numeric state has one owner.
component(Slider, {'.value':1000});
// @ts-expect-error Range controls cannot change native type through props.
component(Slider, {type:'text'});

import { Textarea, Select, NativeSelect } from '@cossackframework/ui';
component(Textarea, {rows:4, cols:40, required:true, wrap:'soft', '.value':live('Notes'),
    '@input':event=>{const control:HTMLTextAreaElement=event.currentTarget;void control;}});
component(Select, {name:'choice', required:true, '.value':'b',
    '@change':event=>{const control:HTMLSelectElement=event.currentTarget;void control;}});
component(NativeSelect, {multiple:true, '.value':bind({choice:'b'},'choice'), '?disabled':false});
// @ts-expect-error HTML textarea has no value attribute; use .value.
component(Textarea, {value:'Notes'});
// @ts-expect-error HTML select has no value attribute; use .value.
component(Select, {value:'b'});
// @ts-expect-error Native select rejects misspelled attributes.
component(NativeSelect, {requried:true});
// @ts-expect-error Textarea does not support input checked state.
component(Textarea, {checked:true});
// @ts-expect-error Select change handlers target a select, not a text input.
component(Select, {'@change':event=>event.currentTarget.selectionStart});
