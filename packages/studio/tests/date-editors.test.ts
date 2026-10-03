import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { CellEditorSheet } from '../app/src/components/studio/CellEditorSheet';
import { InsertRowSheet } from '../app/src/components/studio/InsertRowSheet';
import type { StudioObject } from '../src/lib/schema-types';

const object: StudioObject = {name:'events',kind:'table',sql:null,editable:true,indexes:[],foreignKeys:[],rowLocators:[],columns:[{name:'due date',dataType:'DATE',affinity:'text',declaredKind:'date',nullable:true,defaultValue:null,primaryKeyPosition:0,autoIncrement:false,hidden:false}]};
const noop=()=>{};
it.each(['2024-02-30','legacy text','2024-02-29T12:00:00Z'])('preserves non-date database text %s in the cell editor',value=>{
    const output=renderToString(component(CellEditorSheet,{object,editor:{rowIndex:0,columnName:'due date',value,mode:'value',kind:'date'},theme:'light',saving:false,onClose:noop,onSelectionChange:noop,onValueChange:noop,onSave:noop}));
    expect(output).toMatch(/id="cell-editor-date"[^>]*type="text"/);
    expect(output).toContain(`value="${value}"`);
    expect(output).toContain('for="cell-editor-date"');
});
it.each(['2024-02-29','legacy text'])('keeps insert date labels linked and values editable for %s',value=>{
    const output=renderToString(component(InsertRowSheet,{object,open:true,fields:{'due date':{mode:'value',valueKind:'date',value}},error:'',theme:'light',inserting:false,onClose:noop,onValueChange:noop,onSelectionChange:noop,onRegenerateValue:noop,onSubmit:noop}));
    expect(output).toContain('for="insert-value-due%20date"');
    expect(output).toContain('id="insert-value-due%20date"');
    expect(output).toContain(`value="${value}"`);
    if(value==='2024-02-29')expect(output).toContain('type="date"');
    else expect(output).not.toContain('type="date"');
});
