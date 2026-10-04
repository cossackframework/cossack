import { expect, it } from 'vitest';
import { html, component, renderToString } from '@cossackframework/renderer';
import { ButtonGroup } from '../src/components/ButtonGroup';
import { Separator } from '../src/components/Separator';
import { AspectRatio } from '../src/components/AspectRatio';

it('names a native group and forwards only native extras', () => {
    const output=renderToString(component(ButtonGroup,{id:'actions',label:'Actions',orientation:'vertical','data-owner':'editor'},html`<button type="button">Save</button>`));
    expect(output).toContain('role="group"');expect(output).toContain('aria-label="Actions"');expect(output).toContain('data-orientation="vertical"');expect(output).toContain('data-owner="editor"');expect(output).toContain('type="button"');expect(output).not.toMatch(/\s(?:label|orientation)=/);
});
it.each([{label:''},{label:'Actions',orientation:'diagonal'}])('rejects invalid group contracts', props=>{
    expect(()=>renderToString(component(ButtonGroup,props as any))).toThrow('ButtonGroup');
});
it('renders native or decorative separators with textual ARIA states', () => {
    const horizontal=renderToString(component(Separator,{id:'horizontal'}));expect(horizontal).toContain('<hr');expect(horizontal).not.toContain('aria-hidden');
    const vertical=renderToString(component(Separator,{orientation:'vertical','data-divider':'yes'}));expect(vertical).toContain('role="separator"');expect(vertical).toContain('aria-orientation="vertical"');expect(vertical).toContain('data-divider="yes"');
    for(const orientation of ['horizontal','vertical'] as const){const decorative=renderToString(component(Separator,{orientation,decorative:true}));expect(decorative).toContain('aria-hidden="true"');expect(decorative).not.toContain('role="separator"');expect(decorative).not.toMatch(/\s(?:decorative|orientation)=/);}
});
it('rejects invalid separator orientation',()=>{
    expect(()=>renderToString(component(Separator,{orientation:'diagonal'} as any))).toThrow('Separator');
});
it('separates native wrapper style from the ratio box and preserves children', () => {
    const output=renderToString(component(AspectRatio,{id:'media',ratio:16/9,style:'width:320px','data-media':'cover'},html`<img src="cover.png" alt="Cover">`));
    expect(output).toContain('style="width:320px"');expect(output).toContain(`style="aspect-ratio:${16/9}"`);expect(output).toContain('data-media="cover"');expect(output).toContain('alt="Cover"');expect(output).not.toContain('padding-top');expect(output).not.toMatch(/\sratio=/);
});
it.each([0,-1,NaN,Infinity,-Infinity,'wide'])('rejects invalid aspect ratios: %s',ratio=>{
    expect(()=>renderToString(component(AspectRatio,{ratio} as any))).toThrow('AspectRatio');
});
