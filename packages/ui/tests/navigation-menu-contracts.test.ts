import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { NavigationMenu } from '../src/components/NavigationMenu';

it('renders native navigation, scoped disclosure relationships and readonly links', () => {
    const sections = Object.freeze([{value:'docs"[]',label:'Docs',items:Object.freeze([{value:'guide',label:'Guide',href:'/guide?q="x"',description:'Start here',linkProps:{target:'_blank',rel:'noreferrer','aria-current':'page'}}])}]);
    const output = renderToString(component(NavigationMenu,{id:'main',label:'Primary',sections,'data-nav':'main'}));
    expect(output).toContain('<nav');
    expect(output).toContain('aria-label="Primary"');
    expect(output).toContain('main-panel-docs%22%5B%5D');
    expect(output).toContain('aria-expanded="false"');
    expect(output).toContain('popovertarget="main-panel-docs%22%5B%5D"');
    expect(output).toContain('href="/guide?q=&quot;x&quot;"');
    expect(output).toContain('target="_blank"');
    expect(output).toContain('aria-current="page"');
    expect(output).not.toContain('role="menu');
    expect(output).not.toMatch(/\s(?:sections|openDelay|closeDelay|trigger)=/);
    const other = renderToString(component(NavigationMenu,{id:'other',label:'Other',sections}));
    expect(other).not.toContain('main-panel-');
});
it.each([{id:''},{label:''},{trigger:'unknown'},{openDelay:-1},{closeDelay:Infinity},{sections:[{value:'same',label:'One'},{value:'same',label:'Two'}]},{sections:[{value:'docs',label:'Docs',items:[{value:'guide',label:'',href:'/'}]}]},{sections:[{value:'docs',label:'Docs',items:[{value:'guide',label:'Guide',href:''}]}]},{sections:[{value:'docs',label:'Docs',items:[{value:'guide',label:'Guide',href:'/'},{value:'guide',label:'Other',href:'/other'}]}]}])('rejects invalid navigation contracts: %j', patch => {
    expect(()=>renderToString(component(NavigationMenu,{id:'main',label:'Primary',...patch} as any))).toThrow('NavigationMenu');
});
