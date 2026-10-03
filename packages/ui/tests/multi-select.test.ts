import { expect, it, vi } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { MultiSelect } from '../src/components/MultiSelect';

it('renders labeled tag controls, stable ARIA relationships and repeated form values',()=>{
    const onChange=vi.fn();
    const output=renderToString(component(MultiSelect,{id:'skills',name:'skills',value:['TypeScript','Cossack'],options:['TypeScript','Cossack','Rust'],required:true,'aria-label':'Skills','aria-describedby':'help',onChange}));
    expect(output).toContain('role="combobox"');
    expect(output).toContain('aria-controls="skills-listbox"');
    expect(output).toContain('aria-required="true"');
    expect(output).toContain('aria-describedby="help"');
    expect(output).toContain('aria-label="Remove TypeScript"');
    expect(output).toContain('id="skills-listbox-2"');
    expect(output.match(/type="hidden" name="skills"/g)).toHaveLength(2);
    expect(output).toContain('value="TypeScript"');
    expect(output).toContain('value="Cossack"');
    expect(output).not.toMatch(/onChange=|validate=|defaultValue=/);
    expect(onChange).not.toHaveBeenCalled();
});
it('keeps uncontrolled defaults separate from parent-owned arrays',()=>{
    const defaults=['TypeScript'];const control=new MultiSelect();
    control.props={id:'skills',defaultValue:defaults};
    expect(renderToString(control.render())).toContain('value="TypeScript"');
    defaults.push('Rust');
    expect(renderToString(control.render())).not.toContain('value="Rust"');
    control.props={id:'skills',value:['Rust']};
    expect(renderToString(control.render())).toContain('value="Rust"');
    expect(renderToString(control.render())).not.toContain('value="TypeScript"');
});
it('escapes validation errors and localizes removal labels',()=>{
    const output=renderToString(component(MultiSelect,{id:'skills',value:['Rust'],error:'<script>bad</script>',removeLabel:value=>`Delete ${value}`}));
    expect(output).toContain('role="alert"');
    expect(output).toContain('aria-describedby="skills-error"');
    expect(output).toContain('aria-invalid="true"');
    expect(output).toContain('&lt;script&gt;');
    expect(output).not.toContain('<script>');
    expect(output).toContain('aria-label="Delete Rust"');
});
it.each(['','two words'])('rejects invalid IDs %s',id=>expect(()=>renderToString(component(MultiSelect,{id}))).toThrow('MultiSelect requires'));
it.each([-1,1.2,NaN,Infinity])('rejects invalid max %s',max=>expect(()=>renderToString(component(MultiSelect,{id:'skills',max}))).toThrow('MultiSelect max'));
it.each([{options:['A','A']},{value:['A','A']},{value:[' ']},{options:['']}])('rejects ambiguous values %j',props=>expect(()=>renderToString(component(MultiSelect,{id:'skills',...props}))).toThrow('unique nonempty strings'));
