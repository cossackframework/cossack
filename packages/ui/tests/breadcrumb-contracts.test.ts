import { expect, it } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
import { Breadcrumb } from '../src/components/Breadcrumb';

it('renders readonly hierarchy with native attributes and a current-page link', () => {
    const items = Object.freeze([{value:'home"[]',label:'Home',href:'/'},{value:'docs',label:'Docs',href:'/docs',linkProps:{target:'_blank',rel:'noopener'}}]);
    const output = renderToString(component(Breadcrumb,{id:'trail',label:'Location',items,separator:'›',listProps:{'data-list':'trail'},'data-nav':'main'}));
    expect(output).toContain('aria-label="Location"');
    expect(output).toContain('id="trail"');
    expect(output).toContain('data-nav="main"');
    expect(output).toContain('data-list="trail"');
    expect(output).toMatch(/href="\/docs"[^>]*aria-current="page"/);
    expect(output).toContain('target="_blank"');
    expect(output.match(/aria-current="page"/g)).toHaveLength(1);
    expect(output).toMatch(/aria-hidden="true"[^>]*cs-breadcrumb__separator/);
    expect(output).not.toMatch(/\s(?:items|separator|listProps|label)=/);
});
it('renders named rich text and marks an unlinked current page', () => {
    const output = renderToString(component(Breadcrumb,{items:[{value:'current',label:html`<b>◆</b>`,ariaLabel:'Current location',textProps:{title:'You are here'}}]}));
    expect(output).toContain('aria-current="page"');
    expect(output).toContain('title="You are here"');
    expect(output).toContain('aria-hidden="true"><b>◆</b>');
    expect(output).toContain('class="sr-only">Current location');
    expect(output).not.toContain('<a ');
    expect(output).not.toContain('cs-breadcrumb__separator');
});
it('allows an empty trail and an empty decorative separator', () => {
    const output = renderToString(component(Breadcrumb,{items:[],separator:''}));
    expect(output).toContain('<nav');expect(output).toContain('<ol');expect(output).not.toContain('aria-current');
});
it.each([{label:''},{separator:{}},{items:[{value:'',label:'Home'}]},{items:[{value:'same',label:'Home'},{value:'same',label:'Docs'}]},{items:[{value:'home',label:''}]},{items:[{value:'home',label:'Home',ariaLabel:null}]},{items:[{value:'home',label:html`<b>Home</b>`}]},{items:[{value:'home',label:'Home',href:''}]},{items:[{value:'home',label:'Home',href:'/',textProps:{}}]},{items:[{value:'home',label:'Home',linkProps:{}}]}])('rejects invalid trail contracts: %j', props => {
    expect(()=>renderToString(component(Breadcrumb,props as any))).toThrow('Breadcrumb');
});
