import { expect, it, vi } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { Combobox } from '../src/components/Combobox';

const options = [{value:'us',label:'United States'},{value:'vn',label:'Vietnam'},{value:'de',label:'Germany',disabled:true}];
it('renders selected labels separately from form values and owns popup semantics', () => {
    const change=vi.fn();
    const output=renderToString(component(Combobox,{id:'country',name:'country',options,value:'vn',required:true,'aria-label':'Country','aria-describedby':'help',onValueChange:change}));
    expect(output).toContain('role="combobox"');
    expect(output).toContain('aria-expanded="false"');
    expect(output).toContain('aria-controls="country-listbox"');
    expect(output).toContain('role="listbox"');
    expect(output).toContain('id="country-listbox-1"');
    expect(output).toContain('value="Vietnam"');
    expect(output).toMatch(/type="hidden"[^>]*name="country"[^>]*value="vn"/);
    expect(output).toContain('aria-describedby="help"');
    expect(output).toContain('aria-disabled="true"');
    expect(output).not.toContain('onValueChange=');
    expect(change).not.toHaveBeenCalled();
});
it('uses current options and parent selection rather than retaining an old label', () => {
    const combo=new Combobox();combo.props={id:'country',options,defaultValue:'us'};
    expect(renderToString(combo.render())).toContain('value="United States"');
    combo.props={id:'country',options,defaultValue:'vn'};
    expect(renderToString(combo.render())).toContain('value="United States"');
    combo.props={id:'country',options,value:'vn'};
    expect(renderToString(combo.render())).toContain('value="Vietnam"');
    combo.props={id:'country',options:[{value:'vn',label:'Viet Nam'}],value:'vn'};
    expect(renderToString(combo.render())).toContain('value="Viet Nam"');
    combo.props={id:'country',options,value:'missing'};
    expect(renderToString(combo.render())).not.toContain('value="missing"');
});
it.each(['','two words'])('rejects invalid ID %s',id=>{
    expect(()=>renderToString(component(Combobox,{id}))).toThrow('Combobox requires');
});
it.each([
    [{value:'',label:'Empty'}],
    [{value:'us',label:'US'},{value:'us',label:'Duplicate'}],
    [{value:'us',label:' '}],
].map(options=>({options})))('rejects ambiguous or unnamed options %j',({options})=>{
    expect(()=>renderToString(component(Combobox,{id:'country',options}))).toThrow('Combobox options require');
});
