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


import { InputGroup, PasswordInput } from '@cossackframework/ui';
component(InputGroup, {prefix:'$',type:'number',min:0,'.value':12,required:true,
    '@input':event=>{const input:HTMLInputElement=event.currentTarget;void input;}});
component(PasswordInput, {value:'secret',disabled:false,autocomplete:'new-password',placeholder:'',required:true,
    showLabel:'Reveal password',hideLabel:'Conceal password',
    onChange:(value,event)=>{const input:HTMLInputElement=event.currentTarget;void [value,input];},
    '@input':event=>{const input:HTMLInputElement=event.currentTarget;void input;}});
component(PasswordInput, {'@input':preventDefault(()=>{}, {novalidate:false})});
// @ts-expect-error InputGroup closes arbitrary native attributes.
component(InputGroup, {placehoder:'Amount'});
// @ts-expect-error PasswordInput owns the native type.
component(PasswordInput, {type:'text'});
// @ts-expect-error PasswordInput owns value through one prop.
component(PasswordInput, {'.value':'secret'});
// @ts-expect-error Disabled state belongs to both controls through the disabled prop.
component(PasswordInput, {'?disabled':true});
// @ts-expect-error Password fields do not support file inputs.
component(PasswordInput, {accept:'image/*'});
// @ts-expect-error Password callbacks do not target a textarea.
component(PasswordInput, {onChange:(_value,event)=>{const textarea:HTMLTextAreaElement=event.currentTarget;void textarea;}});


component(InputGroup, {'aria-controls':'results','aria-activedescendant':'result-1','aria-describedby':'help error','aria-labelledby':'label'});
component(PasswordInput, {'aria-details':'password-rules','aria-errormessage':'password-error','aria-flowto':'next','aria-owns':'owned'});
// @ts-expect-error Reference ARIA attributes contain IDs, not DOM reflection elements.
component(Input, {'aria-controls':document.createElement('div')});
// @ts-expect-error Reference ARIA attributes do not accept booleans.
component(Input, {'aria-describedby':false});

import { InputOTP } from '@cossackframework/ui';
component(InputOTP,{length:6,defaultValue:'012345',name:'code',required:true,'aria-label':'Code',
    onChange:(value,event)=>{const input:HTMLInputElement=event.currentTarget;void [value,input];},
    onComplete:code=>{const text:string=code;void text;},
    '@paste':event=>event.clipboardData?.getData('text'),'?disabled':false});
// @ts-expect-error OTP owns its native input type.
component(InputOTP,{type:'number'});
// @ts-expect-error OTP owns value through its value/defaultValue props.
component(InputOTP,{'.value':'123456'});
// @ts-expect-error OTP derives native length from digit count.
component(InputOTP,{maxlength:4});
// @ts-expect-error OTP completion receives text, including leading zeros.
component(InputOTP,{onComplete:(value:number)=>{void value;}});
// @ts-expect-error OTP no longer accepts arbitrary ignored attributes.
component(InputOTP,{placehoder:'Code'});

import { Combobox, type ComboboxOption } from '@cossackframework/ui';
const countries: readonly ComboboxOption[] = [{value:'us',label:'United States',disabled:false}];
component(Combobox,{id:'country',options:countries,name:'country',required:true,'aria-label':'Country',onChange:value=>value.toUpperCase(),'@keydown':event=>event.currentTarget.select()});
// @ts-expect-error Stable SSR/hydration ID is required.
component(Combobox,{options:countries});
// @ts-expect-error The component owns the input role.
component(Combobox,{id:'country',role:'textbox'});
// @ts-expect-error Selected option value belongs to value, not a native value directive.
component(Combobox,{id:'country','.value':'us'});
// @ts-expect-error Options are labeled string values.
component(Combobox,{id:'country',options:[{value:1,label:'One'}]});
// @ts-expect-error No arbitrary prop index signature.
component(Combobox,{id:'country',placehoder:'Search'});

import { MultiSelect } from '@cossackframework/ui';
component(MultiSelect,{id:'skills',name:'skills',value:['TypeScript'] as const,options:['TypeScript','Rust'] as const,required:true,'aria-label':'Skills',onChange:values=>values.map(value=>value.toUpperCase()),validate:value=>value.length>20?'Too long':null,'@input':event=>event.currentTarget.select(),removeLabel:value=>`Delete ${value}`});
// @ts-expect-error Stable ID is required.
component(MultiSelect,{value:[]});
// @ts-expect-error Selection uses string arrays.
component(MultiSelect,{id:'skills',value:'Rust'});
// @ts-expect-error Validation returns an error string or null.
component(MultiSelect,{id:'skills',validate:()=>false});
// @ts-expect-error Native value binding cannot compete with search ownership.
component(MultiSelect,{id:'skills','.value':'Rust'});
// @ts-expect-error ARIA active descendant belongs to the component.
component(MultiSelect,{id:'skills','aria-activedescendant':'other'});
// @ts-expect-error No arbitrary prop index signature.
component(MultiSelect,{id:'skills',placehoder:'Pick'});

import { Calendar, DatePicker } from '@cossackframework/ui';
component(Calendar,{id:'calendar',value:'2024-02-29',locale:'de-DE',weekStartsOn:1,onChange:iso=>iso.toUpperCase(),'@keydown':event=>event.currentTarget.classList.add('used')});
component(DatePicker,{id:'due',name:'due',required:true,min:'2024-01-01',value:'2024-02-29',onChange:iso=>iso.toUpperCase(),'@input':event=>event.currentTarget.checkValidity()});
// @ts-expect-error Calendar needs a stable ID.
component(Calendar,{value:'2024-02-29'});
// @ts-expect-error DatePicker owns its native input type.
component(DatePicker,{id:'due',type:'text'});
// @ts-expect-error Use value, not a competing native binding.
component(DatePicker,{id:'due','.value':'2024-02-29'});
// @ts-expect-error DatePicker's browser-formatted native date field has no placeholder contract.
component(DatePicker,{id:'due',placeholder:'Pick'});
// @ts-expect-error Native events use the input currentTarget.
component(DatePicker,{id:'due','@input':(event: Event & {currentTarget: HTMLTextAreaElement})=>event.currentTarget.rows});

import { Modal, Sheet, Drawer, type DialogControlProps } from '@cossackframework/ui';
const dialogProps: DialogControlProps = { open: true, onClose: event => { const dialog: HTMLDialogElement = event.currentTarget; void dialog.returnValue; }, '@cancel': event => event.preventDefault(), 'aria-label': 'Details' };
component(Modal, dialogProps);
component(Sheet, { ...dialogProps, side: 'left', fullScreen: true });
component(Drawer, { ...dialogProps, title: 'Details', closeLabel: 'Dismiss' });
// @ts-expect-error The component owns native open state.
component(Modal, { '.open': true });
// @ts-expect-error Native dialog semantics cannot be replaced.
component(Sheet, { role: 'button' });
// @ts-expect-error Dialog events target HTMLDialogElement.
component(Drawer, { '@close': (event: Event & { currentTarget: HTMLTextAreaElement }) => {} });
// @ts-expect-error Unknown attributes no longer disappear into an any index.
component(Modal, { unknownOption: true });

import { Popover, type PopoverContentProps } from '@cossackframework/ui';
const popoverContent: PopoverContentProps = { role: 'dialog', 'aria-label': 'Details', '@toggle': event => { const panel: HTMLDivElement = event.currentTarget; void panel; } };
component(Popover, { id: 'details', trigger: 'Details', contentProps: popoverContent, '@click': event => { const trigger: HTMLButtonElement = event.currentTarget; void trigger; }, disabled: true });
// @ts-expect-error Stable identity is required.
component(Popover, { trigger: 'Details' });
// @ts-expect-error Native target belongs to the component.
component(Popover, { id: 'details', popovertarget: 'other' });
// @ts-expect-error Native auto-popover expansion belongs to the browser.
component(Popover, { id: 'details', 'aria-expanded': true });
// @ts-expect-error Panel identity belongs to the component.
component(Popover, { id: 'details', contentProps: { id: 'other' } });
// @ts-expect-error The panel is not a button.
component(Popover, { id: 'details', contentProps: { '@click': (event: Event & { currentTarget: HTMLButtonElement }) => {} } });
// @ts-expect-error Unknown options no longer disappear into an any index.
component(Popover, { id: 'details', open: true });

import { DropdownMenu, ContextMenu, type MenuItem, type MenuPanelProps } from '@cossackframework/ui';
const menuItems: readonly MenuItem[] = [{ label: 'Edit', onClick: event => { const button: HTMLButtonElement = event.currentTarget; void button; } }, { separator: true }];
const menuPanel: MenuPanelProps = { '@keydown': event => { const panel: HTMLDivElement = event.currentTarget; void panel; } };
component(DropdownMenu, { id: 'actions', trigger: 'Actions', items: menuItems, menuProps: menuPanel, '@click': event => { const button: HTMLButtonElement = event.currentTarget; void button; } });
component(ContextMenu, { id: 'document', menuLabel: 'Document actions', items: menuItems, '@contextmenu': event => { const region: HTMLDivElement = event.currentTarget; void region; } });
// @ts-expect-error Stable IDs are required.
component(DropdownMenu, { trigger: 'Actions' });
// @ts-expect-error Context menus require a name.
component(ContextMenu, { id: 'document' });
// @ts-expect-error A separator cannot also be an action.
const invalidSeparator: MenuItem = { separator: true, label: 'Edit', onClick: () => {} };
// @ts-expect-error Menu roles belong to the component.
component(DropdownMenu, { id: 'actions', menuProps: { role: 'dialog' } });
// @ts-expect-error Native trigger targeting belongs to the component.
component(DropdownMenu, { id: 'actions', popovertarget: 'other' });
// @ts-expect-error Arbitrary unimplemented options are rejected.
component(ContextMenu, { id: 'document', menuLabel: 'Actions', open: true });
void invalidSeparator;

import { Tooltip, HoverCard } from '@cossackframework/ui';
component(Tooltip, { id: 'help', label: 'Help', delay: 150, '@pointerenter': event => { const span: HTMLSpanElement = event.currentTarget; void span; } });
component(HoverCard, { id: 'details', label: 'Details', content: 'Details', contentProps: { '@click': event => { const div: HTMLDivElement = event.currentTarget; void div; } } });
// @ts-expect-error Stable tooltip IDs are required.
component(Tooltip, { label: 'Help' });
// @ts-expect-error Tooltip content is plain description text, not arbitrary markup.
component(Tooltip, { id: 'help', label: { text: 'Help' } });
// @ts-expect-error The old ignored content prop was never a tooltip label.
component(Tooltip, { id: 'help', content: 'Help' });
// @ts-expect-error HoverCard needs an accessible name.
component(HoverCard, { id: 'details', content: 'Details' });
// @ts-expect-error The card owns its nonmodal dialog role.
component(HoverCard, { id: 'details', label: 'Details', content: '', contentProps: { role: 'tooltip' } });

import { AlertDialog } from '@cossackframework/ui';
component(AlertDialog, { id: 'confirm', title: 'Delete?', onAction: event => { const button: HTMLButtonElement = event.currentTarget; void button; }, '@cancel': event => { const dialog: HTMLDialogElement = event.currentTarget; void dialog; } });
// @ts-expect-error Stable identity is required.
component(AlertDialog, { title: 'Delete?' });
// @ts-expect-error Accessible title must be text.
component(AlertDialog, { id: 'confirm', title: {} });
// @ts-expect-error Dialog semantics belong to the component.
component(AlertDialog, { id: 'confirm', title: 'Delete?', role: 'button' });
// @ts-expect-error Alert dialogs never dismiss on backdrop clicks.
component(AlertDialog, { id: 'confirm', title: 'Delete?', closeOnBackdrop: true });
// @ts-expect-error Arbitrary props are not implemented.
component(AlertDialog, { id: 'confirm', title: 'Delete?', busy: true });

import { Command, type CommandItem } from '@cossackframework/ui';
const commands: readonly CommandItem[] = [{ id: '/home', label: 'Home', disabled: false }];
component(Command, { id: 'commands', label: 'Navigate', items: commands, shortcut: true, onOpenChange: open => { const value: boolean = open; void value; }, '@cancel': event => { const dialog: HTMLDialogElement = event.currentTarget; void dialog; } });
// @ts-expect-error Stable identity is required.
component(Command, { label: 'Navigate' });
// @ts-expect-error Accessible name is required.
component(Command, { id: 'commands' });
// @ts-expect-error Command owns its modal role.
component(Command, { id: 'commands', label: 'Navigate', role: 'listbox' });
// @ts-expect-error Arbitrary unimplemented props are rejected.
component(Command, { id: 'commands', label: 'Navigate', fuzzy: true });

import { AccordionItem, Collapsible } from '@cossackframework/ui';
component(AccordionItem, { id: 'section', summary: 'Details', headingLevel: 2, '@click': event => { const div: HTMLDivElement = event.currentTarget; void div; }, triggerProps: { '@click': event => { const button: HTMLButtonElement = event.currentTarget; void button; } }, panelProps: { '@keydown': event => { const div: HTMLDivElement = event.currentTarget; void div; } } });
component(Collapsible, { id: 'more', trigger: 'More', open: true, onToggle: open => { const value: boolean = open; void value; } });
// @ts-expect-error Stable IDs are required.
component(AccordionItem, { summary: 'Details' });
// @ts-expect-error Trigger content is now text in the owned native button.
component(Collapsible, { id: 'more', trigger: {} });
// @ts-expect-error Trigger state and relationships belong to the disclosure.
component(Collapsible, { id: 'more', trigger: 'More', triggerProps: { 'aria-expanded': true } });
// @ts-expect-error Panel animation style belongs to the disclosure.
component(AccordionItem, { id: 'section', summary: 'Details', panelProps: { style: 'height:20px' } });
