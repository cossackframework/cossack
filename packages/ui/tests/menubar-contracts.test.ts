import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { Menubar } from '../src/components/Menubar';

it('renders a named menubar with instance-scoped relationships and readonly items', () => {
    const menus = Object.freeze([{value:'file"[]',label:'File',items:Object.freeze([{label:'Save',disabled:true},{separator:true as const}])},{value:'edit',label:'Edit',disabled:true}]);
    const first = renderToString(component(Menubar,{id:'editor-a',label:'Editor actions',menus,chevron:true,'data-editor':'a'}));
    const second = renderToString(component(Menubar,{id:'editor-b',label:'Other actions',menus}));
    expect(first).toContain('role="menubar" aria-label="Editor actions"');
    expect(first).toContain('data-editor="a"');
    expect(first).toContain('editor-a-menu-file%22%5B%5D');
    expect(first).toContain('aria-labelledby="editor-a-trigger-file%22%5B%5D"');
    expect(second).not.toContain('editor-a-menu-');
    expect(first).toContain('aria-disabled="true"');
    expect(first.match(/tabindex="0"/g)).toHaveLength(1);
    expect(first).toContain('role="separator"');
    expect(first).not.toMatch(/\s(?:menus|chevron)=/);
});
it.each([{id:''},{label:''},{menus:[{value:'x',label:''}]},{menus:[{value:'x',label:'One'},{value:'x',label:'Two'}]},{menus:[{value:'x',label:'File',items:[{label:{}}]}]}])('rejects malformed menubar contracts: %j', patch => {
    expect(()=>renderToString(component(Menubar,{id:'editor',label:'Editor',...patch} as any))).toThrow();
});
