import { DataTable, type DataTableColumn, type DataTableProps } from '@cossackframework/ui';
import { component, html } from '@cossackframework/renderer';
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

import { Tabs, type TabsItem } from '@cossackframework/ui';
const tabItems: readonly TabsItem[] = [{ value: 'a', label: 'A' }, { value: 'b', label: { text: 'B' }, ariaLabel: 'B' }];
component(Tabs, { id: 'tabs', label: 'Sections', items: tabItems, activation: 'manual', onChange: value => { const selected: string = value; void selected; }, listProps: { '@keydown': event => { const div: HTMLDivElement = event.currentTarget; void div; } } });
// @ts-expect-error Stable IDs are required.
component(Tabs, { label: 'Sections' });
// @ts-expect-error Named tab lists are required.
component(Tabs, { id: 'tabs' });
// @ts-expect-error Rich labels need an explicit accessible name.
component(Tabs, { id: 'tabs', label: 'Sections', items: [{ value: 'a', label: {} }] });
// @ts-expect-error The component owns the list role.
component(Tabs, { id: 'tabs', label: 'Sections', listProps: { role: 'listbox' } });

import { Toggle, ToggleGroup, type ToggleGroupItem } from '@cossackframework/ui';
component(Toggle, { defaultPressed: true, 'aria-label': 'Bold', onPressedChange: value => { const pressed: boolean = value; void pressed; }, '@click': event => { const button: HTMLButtonElement = event.currentTarget; void button; } });
const toggleItems: readonly ToggleGroupItem[] = [{ value: 'bold', label: 'Bold' }];
component(ToggleGroup, { label: 'Format', items: toggleItems, value: 'bold', onChange: value => { const selected: string = value; void selected; } });
component(ToggleGroup, { label: 'Format', type: 'multiple', value: ['bold'] as const, onChange: values => {
    const selected: string[] = values;
    // @ts-expect-error Multiple mode never emits a scalar string.
    const single: string = values;
    void selected; void single;
}, '@keydown': event => { const group: HTMLDivElement = event.currentTarget; void group; } });
// @ts-expect-error Pressed semantics belong to Toggle.
component(Toggle, { 'aria-pressed': true });
// @ts-expect-error Toggles cannot submit a form.
component(Toggle, { type: 'submit' });
// @ts-expect-error A group name is required.
component(ToggleGroup, { items: toggleItems });
// @ts-expect-error Single mode accepts a string selection.
component(ToggleGroup, { label: 'Format', type: 'single', value: ['bold'] });
// @ts-expect-error Multiple mode accepts an array selection.
component(ToggleGroup, { label: 'Format', type: 'multiple', value: 'bold' });
// @ts-expect-error Rich labels require explicit names.
component(ToggleGroup, { label: 'Format', items: [{ value: 'bold', label: {} }] });

// The object overload retains default-mode contextual typing without losing optional props.
component(ToggleGroup, { label: 'Format', onChange: value => {
    const selected: string = value;
    // @ts-expect-error Default single mode never emits an array.
    const multiple: string[] = value;
    void selected; void multiple;
} });
component(ToggleGroup, { label: 'Format', type: 'single', onChange: value => { const selected: string = value; void selected; } });
component(ToggleGroup);
component(ToggleGroup, undefined, 'Children');
declare const optionalToggleProps: import('@cossackframework/ui').ToggleGroupProps | undefined;
component(ToggleGroup, optionalToggleProps);

import { Menubar, type MenubarMenu } from '@cossackframework/ui';
const barMenus: readonly MenubarMenu[] = [{ value: 'file', label: 'File', items: [{ label: 'Save', onClick: event => { const button: HTMLButtonElement = event.currentTarget; void button; } }] }];
component(Menubar, { id: 'editor', label: 'Editor', menus: barMenus, '@keydown': event => { const root: HTMLDivElement = event.currentTarget; void root; } });
component(Menubar, { id: 'editor', label: 'Editor', menus: [{value:'file',label:'File',triggerProps:{'@click':event=>{const button:HTMLButtonElement=event.currentTarget;void button;}},menuProps:{'@keydown':event=>{const panel:HTMLDivElement=event.currentTarget;void panel;}}}] });
// @ts-expect-error The menubar needs its own identity.
component(Menubar, { label: 'Editor' });
// @ts-expect-error Stable menu values are required.
component(Menubar, { id: 'editor', label: 'Editor', menus: [{ label: 'File' }] });
// @ts-expect-error The component owns trigger expansion semantics.
component(Menubar, { id: 'editor', label: 'Editor', menus: [{ value: 'file', label: 'File', triggerProps: { 'aria-expanded': true } }] });
// @ts-expect-error Action labels supply accessible and typeahead names.
component(Menubar, { id: 'editor', label: 'Editor', menus: [{ value: 'file', label: 'File', items: [{label:{}}] }] });

import { NavigationMenu, type NavigationMenuSection, type AnchorAttributes } from '@cossackframework/ui';
const navSections: readonly NavigationMenuSection[] = [{ value: 'docs', label: 'Docs', items: [{value:'guide',label:'Guide',href:'/guide',linkProps:{target:'_blank',download:'guide.html','@click':event=>{const link:HTMLAnchorElement=event.currentTarget;void link;}}}],triggerProps:{'@click':event=>{const button:HTMLButtonElement=event.currentTarget;void button;}},panelProps:{'@keydown':event=>{const panel:HTMLDivElement=event.currentTarget;void panel;}} }];
component(NavigationMenu,{id:'primary',label:'Primary navigation',sections:navSections,'@keydown':event=>{const nav:HTMLElement=event.currentTarget;void nav;}});
const nativeAnchor: AnchorAttributes = {href:'/guide',target:'_blank',rel:'noopener',referrerpolicy:'no-referrer'};void nativeAnchor;
// @ts-expect-error A named navigation landmark is required.
component(NavigationMenu,{id:'primary'});
// @ts-expect-error Stable section identities are required.
component(NavigationMenu,{id:'primary',label:'Primary',sections:[{label:'Docs'}]});
// @ts-expect-error Stable link identities are required.
component(NavigationMenu,{id:'primary',label:'Primary',sections:[{value:'docs',label:'Docs',items:[{label:'Guide',href:'/guide'}]}]});
// @ts-expect-error Trigger expansion belongs to the component.
component(NavigationMenu,{id:'primary',label:'Primary',sections:[{value:'docs',label:'Docs',triggerProps:{'aria-expanded':true}}]});
// @ts-expect-error Links own href outside the native extras.
component(NavigationMenu,{id:'primary',label:'Primary',sections:[{value:'docs',label:'Docs',items:[{value:'guide',label:'Guide',href:'/guide',linkProps:{href:'/other'}}]}]});

import { Pagination, type PaginationButtonProps, type PaginationLinkProps } from '@cossackframework/ui';
component(Pagination,{page:1,totalPages:5,onPageChange:page=>{const value:number=page;void value;},'@keydown':event=>{const root:HTMLElement=event.currentTarget;void root;},buttonProps:{'@click':event=>{const button:HTMLButtonElement=event.currentTarget;void button;}}});
component(Pagination,{page:1,totalPages:5,href:page=>`/page/${page}`,linkProps:{target:'_blank','@click':event=>{const link:HTMLAnchorElement=event.currentTarget;void link;}}});
const pageButtonProps:PaginationButtonProps={title:'Page'};const pageLinkProps:PaginationLinkProps={rel:'nofollow'};void pageButtonProps;void pageLinkProps;
// @ts-expect-error Choose a page change callback or native URL navigation.
component(Pagination,{page:1,totalPages:5});
// @ts-expect-error URL navigation and selection callbacks are separate contracts.
component(Pagination,{page:1,totalPages:5,href:page=>`/page/${page}`,onPageChange:()=>{}});
// @ts-expect-error Link extras cannot override the generated URL.
component(Pagination,{page:1,totalPages:5,href:page=>`/page/${page}`,linkProps:{href:'/wrong'}});
// @ts-expect-error Native attributes have explicit names.
component(Pagination,{page:1,totalPages:5,onPageChange:()=>{},clas:'pages'});
// @ts-expect-error Native control ownership prevents accidental submit buttons.
component(Pagination,{page:1,totalPages:5,onPageChange:()=>{},buttonProps:{type:'submit'}});

import { Breadcrumb, type BreadcrumbItem } from '@cossackframework/ui';
const trail:readonly BreadcrumbItem[]=[{value:'home',label:'Home',href:'/',linkProps:{target:'_blank','@click':event=>{const link:HTMLAnchorElement=event.currentTarget;void link;}}},{value:'current',label:html`<b>Current</b>`,ariaLabel:'Current page',textProps:{'@click':event=>{const text:HTMLSpanElement=event.currentTarget;void text;}}}];
component(Breadcrumb,{items:trail,label:'Location','@keydown':event=>{const root:HTMLElement=event.currentTarget;void root;},listProps:{'@click':event=>{const list:HTMLOListElement=event.currentTarget;void list;}}});
// @ts-expect-error Stable identities are required.
component(Breadcrumb,{items:[{label:'Home',href:'/'}]});
// @ts-expect-error Rich labels need an accessible text name.
component(Breadcrumb,{items:[{value:'home',label:html`<b>Home</b>`}]});
// @ts-expect-error Unlinked text does not accept anchor attributes.
component(Breadcrumb,{items:[{value:'home',label:'Home',linkProps:{target:'_blank'}}]});
// @ts-expect-error Link targets and text targets are separate contracts.
component(Breadcrumb,{items:[{value:'home',label:'Home',href:'/',textProps:{title:'Wrong'}}]});
// @ts-expect-error Current-page semantics belong to the component.
component(Breadcrumb,{items:[{value:'home',label:'Home',href:'/',linkProps:{'aria-current':'page'}}]});
// @ts-expect-error Native root attributes are closed.
component(Breadcrumb,{clas:'trail'});

import { ButtonGroup, Separator, AspectRatio } from '@cossackframework/ui';
component(ButtonGroup,{label:'Actions','@click':event=>{const root:HTMLDivElement=event.currentTarget;void root;}},html`<button>Save</button>`);
component(Separator,{'@click':event=>{const rule:HTMLHRElement=event.currentTarget;void rule;}});
component(Separator,{orientation:'vertical',decorative:true,'@click':event=>{const divider:HTMLDivElement=event.currentTarget;void divider;}});
component(AspectRatio,{ratio:16/9,style:'max-width:40rem','@click':event=>{const wrapper:HTMLDivElement=event.currentTarget;void wrapper;}},html`<img alt="Cover">`);
// @ts-expect-error A named group is required.
component(ButtonGroup,{});
// @ts-expect-error Native group semantics belong to the component.
component(ButtonGroup,{label:'Actions',role:'toolbar'});
// @ts-expect-error Orientation owns its data attribute.
component(ButtonGroup,{label:'Actions','data-orientation':'vertical'});
// @ts-expect-error A static separator is not a keyboard splitter.
component(Separator,{tabindex:0});
// @ts-expect-error Use decorative instead of overriding owned ARIA state.
component(Separator,{'aria-hidden':true});
// @ts-expect-error Ratios are numeric.
component(AspectRatio,{ratio:'16/9'});
// @ts-expect-error Native attributes are closed.
component(AspectRatio,{clas:'media'});

import { Skeleton, Card, CardHeader, CardBody, CardFooter, Badge, Kbd } from '@cossackframework/ui';
component(Skeleton,{circle:true,size:40,'@click':event=>{const shape:HTMLDivElement=event.currentTarget;void shape;}});
component(Skeleton,{width:'60%',height:16});
component(Card,{hoverable:true,padding:'none','@click':event=>{const card:HTMLDivElement=event.currentTarget;void card;}});
component(CardHeader,{'@click':event=>{const header:HTMLDivElement=event.currentTarget;void header;}});
component(CardBody,{'@click':event=>{const body:HTMLDivElement=event.currentTarget;void body;}});
component(CardFooter,{'@click':event=>{const footer:HTMLDivElement=event.currentTarget;void footer;}});
component(Badge,{variant:'success','@click':event=>{const badge:HTMLSpanElement=event.currentTarget;void badge;}},'Saved');
component(Kbd,{'@click':event=>{const key:HTMLElement=event.currentTarget;void key;}},'Ctrl');
// @ts-expect-error Circle dimensions use one size.
component(Skeleton,{circle:true,width:'40px',height:'40px'});
// @ts-expect-error Rectangle dimensions do not accept size.
component(Skeleton,{size:40});
// @ts-expect-error Decorative skeletons cannot enter Tab order.
component(Skeleton,{tabindex:0});
// @ts-expect-error Skeleton owns its hidden semantics.
component(Skeleton,{'aria-hidden':false});
// @ts-expect-error Use hoverable for the visual effect; native actions belong to child controls.
component(Card,{interactive:true});
// @ts-expect-error Slot attributes are closed.
component(CardHeader,{clas:'header'});
// @ts-expect-error Badge variants are closed.
component(Badge,{variant:'unknown'});
// @ts-expect-error Kbd is descriptive markup, not a button.
component(Kbd,{disabled:true});

import { Alert, Progress, Spinner } from '@cossackframework/ui';
component(Alert, { announcement: 'polite', '@click': event => { const root: HTMLDivElement = event.currentTarget; void root; } }, 'Saved');
component(Progress, { label: 'Upload', value: null, '@click': event => { const root: HTMLDivElement = event.currentTarget; void root; } });
component(Spinner, { label: 'Loading', '@click': event => { const svg: SVGSVGElement = event.currentTarget; void svg; } });
// @ts-expect-error Progress requires a name.
component(Progress, { value: 10 });
// @ts-expect-error Progress owns its numeric attributes.
component(Progress, { label: 'Upload', 'aria-valuenow': 10 });
// @ts-expect-error Alert announcement controls its role.
component(Alert, { role: 'button' });
// @ts-expect-error Spinner has an SVG root, not an HTML input.
component(Spinner, { disabled: true });
// @ts-expect-error Spinner size owns its geometry.
component(Spinner, { width: 20 });
// @ts-expect-error Spinner owns hidden semantics.
component(Spinner, { 'aria-hidden': false });
// @ts-expect-error Spinner cannot enter the Tab order.
component(Spinner, { tabindex: 0 });
// @ts-expect-error Event currentTarget is SVG, not HTML.
component(Spinner, { '@click': (event: MouseEvent & {currentTarget: HTMLDivElement}) => event });

import { Field, Empty, type FieldControlAttributes } from '@cossackframework/ui';
component(Field, { label: 'Email', for: 'email', control: attributes => {
    const shared: FieldControlAttributes = attributes;
    return component(Input, { ...shared, type: 'email', '@input': event => { const input: HTMLInputElement = event.currentTarget; void input; } });
}, '@click': event => { const root: HTMLDivElement = event.currentTarget; void root; } });
component(Empty, { title: 'No results', '@click': event => { const root: HTMLDivElement = event.currentTarget; void root; } });
// @ts-expect-error Field requires a target ID.
component(Field, { label: 'Email', control: () => '' });
// @ts-expect-error Field requires a visible label.
component(Field, { for: 'email', control: () => '' });
// @ts-expect-error Field requires an explicitly linked control callback.
component(Field, { label: 'Email', for: 'email' }, component(Input));
// @ts-expect-error Field does not own input values.
component(Field, { label: 'Email', for: 'email', control: () => '', value: 'text' });
// @ts-expect-error Empty has a native div, not a button.
component(Empty, { disabled: true });

import { Avatar, AvatarGroup, type AvatarGroupItem } from '@cossackframework/ui';
component(Avatar, {alt:'Alice', '@click': event=>{const root:HTMLSpanElement=event.currentTarget;void root;},onImageError:event=>{const image:HTMLImageElement=event.currentTarget;void image;}});
component(Avatar, {alt:'', loading:'lazy', decoding:'async', referrerpolicy:'no-referrer'});
const people: readonly AvatarGroupItem[] = [{value:'alice',alt:'Alice'}];
component(AvatarGroup, {label:'People',items:people,'@click':event=>{const group:HTMLDivElement=event.currentTarget;void group;},overflowLabel:count=>`${count} more`});
// @ts-expect-error Explicit alt text is required, including empty for decoration.
component(Avatar, {src:'/person.png'});
// @ts-expect-error Avatar owns its accessible name.
component(Avatar, {alt:'Alice','aria-label':'Override'});
// @ts-expect-error Group items require stable identity.
component(AvatarGroup, {label:'People',items:[{alt:'Alice'}]});
// @ts-expect-error A group requires a name.
component(AvatarGroup, {items:people});
// @ts-expect-error Image callbacks do not target a form input.
component(Avatar, {alt:'Alice',onImageLoad:(event:Event & {currentTarget: HTMLInputElement})=>event});

import { Typography, Item } from '@cossackframework/ui';
component(Typography, {'@click': event=>{const p:HTMLParagraphElement=event.currentTarget;void p;}});
component(Typography, {variant:'h2','@click':event=>{const h:HTMLHeadingElement=event.currentTarget;void h;}});
component(Typography, {variant:'blockquote',cite:'https://example.test','@click':event=>{const q:HTMLQuoteElement=event.currentTarget;void q;}});
component(Typography, {variant:'ol',start:3,reversed:true,type:'A','@click':event=>{const ol:HTMLOListElement=event.currentTarget;void ol;}});
component(Typography, {variant:'ul','@click':event=>{const ul:HTMLUListElement=event.currentTarget;void ul;}});
component(Typography, {variant:'code','@click':event=>{const inline:HTMLElement=event.currentTarget;void inline;}});
component(Item, {hoverable:true,'@click':event=>{const row:HTMLDivElement=event.currentTarget;void row;}});
// @ts-expect-error Default paragraphs have no ordered-list start attribute.
component(Typography, {start:3});
// @ts-expect-error A quote source applies only to blockquote.
component(Typography, {variant:'p',cite:'/source'});
// @ts-expect-error Unordered lists do not accept reversed numbering.
component(Typography, {variant:'ul',reversed:true});
// @ts-expect-error Variants are closed.
component(Typography, {variant:'h7'});
// @ts-expect-error Item hover is visual; the old name is removed.
component(Item, {interactive:true});
// @ts-expect-error Item is not a native button.
component(Item, {disabled:true});

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, ScrollArea, type TableCellAttributes, type TableHeadAttributes } from '@cossackframework/ui';
component(Table, {'aria-label':'People',wrapperProps:{'@scroll':event=>{const wrapper:HTMLDivElement=event.currentTarget;void wrapper;}},'@click':event=>{const table:HTMLTableElement=event.currentTarget;void table;}});
component(TableHeader, {'@click':event=>{const head:HTMLTableSectionElement=event.currentTarget;void head;}});
component(TableBody, {'@click':event=>{const body:HTMLTableSectionElement=event.currentTarget;void body;}});
component(TableRow, {'@click':event=>{const row:HTMLTableRowElement=event.currentTarget;void row;}});
const headerAttributes:TableHeadAttributes={scope:'col',abbr:'Name',colspan:2};
const cellAttributes:TableCellAttributes={headers:'name',rowspan:2};
component(TableHead, {...headerAttributes,'@click':event=>{const cell:HTMLTableCellElement=event.currentTarget;void cell;}});
component(TableCell, {...cellAttributes,'@click':event=>{const cell:HTMLTableCellElement=event.currentTarget;void cell;}});
component(ScrollArea, {label:'Messages',height:100,'@scroll':event=>{const viewport:HTMLDivElement=event.currentTarget;void viewport;}});
// @ts-expect-error Scroll regions require a name.
component(ScrollArea, {height:100});
// @ts-expect-error The label owns the region name.
component(ScrollArea, {label:'Messages','aria-label':'Other'});
// @ts-expect-error ScrollArea is a div, not a textarea.
component(ScrollArea, {label:'Messages',rows:3});
// @ts-expect-error Table props target a table, not a form input.
component(Table, {'@click':(event:MouseEvent & {currentTarget:HTMLInputElement})=>event});
// @ts-expect-error Cell attributes do not apply to the table.
component(Table, {colspan:2});
// @ts-expect-error Scope applies to header cells only.
component(TableCell, {scope:'col'});
// @ts-expect-error Header scopes are closed.
component(TableHead, {scope:'column'});
// @ts-expect-error Row props are closed.
component(TableRow, {clas:'row'});
