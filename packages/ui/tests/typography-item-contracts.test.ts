import { expect, it } from 'vitest';
import { component, html, renderToString, ifDefined } from '@cossackframework/renderer';
import { Typography, type TypographyProps } from '../src/components/Typography';
import { Item } from '../src/components/Item';

it.each(['h1','h2','h3','h4','p','lead','muted','small','code','kbd','ul','ol','blockquote'] as const)('renders the native %s contract without leaking variant', variant => {
    const tag = ['lead','muted'].includes(variant) ? 'p' : variant;
    const output = renderToString(component(Typography,{variant,id:'text','data-variant':variant} as TypographyProps, 'Content'));
    expect(output).toContain(`<${tag}`);expect(output).toContain(`</${tag}>`);expect(output).toContain('id="text"');
    expect(output).toContain('Content');expect(output).not.toMatch(/\svariant=/);
});
it('forwards native list numbering and quotation source attributes', () => {
    const list = renderToString(component(Typography,{variant:'ol',start:5,reversed:true,type:'A'},html`<li>First</li>`));
    expect(list).toContain('start="5"');expect(list).toMatch(/\sreversed(?:\s|=|>)/);expect(list).toContain('type="A"');
    const quote=renderToString(component(Typography,{variant:'blockquote',cite:'https://example.test/source'},'Quoted text'));
    expect(quote).toContain('cite="https://example.test/source"');
});
it.each(['unknown','__proto__','constructor'])('rejects unsupported typography %s', variant=>{
    expect(()=>renderToString(component(Typography,{variant} as any))).toThrow('Typography');
});
it('keeps item media/content/actions native and consumes visual options', () => {
    const output = renderToString(component(Item,{id:'row',hoverable:true,compact:true,divider:false,media:'Icon',trailing:html`<button type="button">Edit</button>`,'data-row':'one'},html`<a href="/record">Record</a>`));
    expect(output).toContain('id="row"');expect(output).toContain('data-row="one"');expect(output).toContain('<a href="/record">Record</a>');
    expect(output).toContain('<button type="button">Edit</button>');expect(output).toContain('hover:bg-accent');expect(output).toContain('motion-reduce:transition-none');
    expect(output).not.toContain('cursor-pointer');expect(output).not.toContain('role="button"');expect(output).not.toContain('tabindex');
    expect(output).not.toMatch(/\s(?:hoverable|divider|compact|media|trailing)=/);
});
it('rejects invalid Item visual flags',()=>{
    expect(()=>renderToString(component(Item,{hoverable:'yes'} as any))).toThrow('Item');
});

it('maps ordered-list marker types including optional native directives', () => {
    for (const [type, marker] of [['a','lower-alpha'],['A','upper-alpha'],['i','lower-roman'],['I','upper-roman']] as const) {
        for (const value of [type, ifDefined(type)]) expect(renderToString(component(Typography,{variant:'ol',type:value},html`<li>Text</li>`))).toContain(`list-[${marker}]`);
    }
    expect(renderToString(component(Typography,{variant:'ol',type:ifDefined(undefined)},html`<li>Text</li>`))).toContain('list-decimal');
});
