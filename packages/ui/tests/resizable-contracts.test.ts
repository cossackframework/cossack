import { expect, it } from 'vitest';
import { component, html, renderToString, ifDefined } from '@cossackframework/renderer';
import { Resizable, type ResizableProps } from '../src/components/Resizable';
const props: ResizableProps = {id:'split',label:'Navigation',primary:'First',secondary:'Second'};
it('renders explicit panels and a named, linked adjustable separator during SSR',()=>{
    const output=renderToString(component(Resizable,{...props,defaultSize:30,primaryProps:{'data-panel':'one'},secondaryProps:{title:'Details'},handleProps:{title:'Resize'},'data-root':'split'}));
    for(const attr of ['id="split-primary"','id="split-secondary"','id="split-handle"','aria-label="Navigation"','aria-controls="split-primary"','role="separator"','tabindex="0"','aria-orientation="vertical"','aria-valuemin="10"','aria-valuemax="90"','aria-valuenow="30"','data-root="split"','data-panel="one"'])expect(output).toContain(attr);
    expect(output).toContain('30fr');expect(output).toContain('70fr');expect(output).toContain('First');expect(output).toContain('Second');
    expect(output).not.toMatch(/\s(?:defaultSize|minSize|primary|secondary|handleProps|onSizeChange)=/);
});
it('renders vertical, bounded, disabled and collapsed states',()=>{
    const output=renderToString(component(Resizable,{...props,orientation:'vertical',size:95,minSize:20,disabled:true}));
    expect(output).toContain('aria-valuenow="80"');expect(output).toContain('aria-orientation="horizontal"');expect(output).toContain('aria-disabled="true"');expect(output).toContain('tabindex="-1"');
    const collapsed=renderToString(component(Resizable,{...props,size:0,minSize:0}));
    expect(collapsed).toMatch(/id="split-primary"[^>]*inert[^>]*aria-hidden="true"/);
    const fixed=renderToString(component(Resizable,{...props,minSize:50}));
    expect(fixed).toContain('aria-disabled="true"');expect(fixed).toContain('aria-valuenow="50"');
});
it('captures defaults once, respects controlled size and composes authored styles',()=>{
    const instance=new Resizable();instance.props={...props,defaultSize:30,style:ifDefined('height:200px;')};
    expect(renderToString(instance.render())).toContain('aria-valuenow="30"');
    instance.props={...props,defaultSize:70};expect(renderToString(instance.render())).toContain('aria-valuenow="30"');
    instance.props={...props,size:60};expect(renderToString(instance.render())).toContain('aria-valuenow="60"');
    expect(renderToString(component(Resizable,{...props,style:ifDefined('height:200px;')}))).toContain('height:200px;');
});
it.each([
    {id:''},{id:'bad id'},{label:''},{label:'  '},{size:NaN},{size:101},{defaultSize:-1},
    {minSize:-1},{minSize:51},{minSize:Infinity},{minSize:null},{step:0},{step:NaN},{step:101},{step:null},
    {orientation:'diagonal'},{disabled:'false'},{onSizeChange:'invalid'},
])('rejects invalid semantic props %j',patch=>{
    expect(()=>renderToString(component(Resizable,{...props,...patch} as any))).toThrow('Resizable');
});
it('requires both named panels and rejects the ambiguous legacy children contract',()=>{
    expect(()=>renderToString(component(Resizable,{id:'split',label:'Panels',primary:'One'} as any))).toThrow('explicit primary and secondary');
    expect(()=>renderToString(component(Resizable,props,html`<p>Extra</p>`))).toThrow('not children');
});
