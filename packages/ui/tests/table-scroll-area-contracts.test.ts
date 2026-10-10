import { expect, it } from 'vitest';
import { component, html, renderToString, ifDefined } from '@cossackframework/renderer';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../src/components/Table';
import { ScrollArea } from '../src/components/ScrollArea';

it('separates table and overflow wrapper attributes and consumes options', () => {
    const output = renderToString(component(Table, { id: 'table', 'aria-label': 'People', striped: true, wrapperProps: { id: 'wrapper', tabindex: 0 } }, html`<caption>People</caption>`));
    expect(output).toMatch(/<div[^>]*id="wrapper"[^>]*tabindex="0"/);
    expect(output).toMatch(/<table[^>]*id="table"[^>]*aria-label="People"/);
    expect(output).toContain('[&amp;&gt;tbody&gt;tr:nth-child(even)]:bg-muted/50');
    expect(output).toContain('<caption>People</caption>');
    expect(output).not.toMatch(/\s(?:striped|wrapperProps)=/);
});
it('renders all native table sections and cell attributes in composition', () => {
    const output = renderToString(component(Table, {}, html`${component(TableHeader, {id:'head'}, component(TableRow, {}, component(TableHead, {id:'name',scope:'col',abbr:'Name',colspan:2}, 'Full name')))}${component(TableBody, {id:'body'}, component(TableRow, {id:'row'}, component(TableCell, {headers:'name',rowspan:2}, 'Alice')))}`));
    for (const tag of ['table','thead','tbody','tr','th','td']) expect(output).toContain(`<${tag}`);
    for (const attr of ['scope="col"','abbr="Name"','colspan="2"','headers="name"','rowspan="2"']) expect(output).toContain(attr);
    expect(output).toContain('motion-reduce:transition-none');
});
it('rejects invalid striped flags', () => {
    expect(() => renderToString(component(Table, {striped:'yes'} as any))).toThrow('Table striped');
});
it('puts name, focus, sizing, styles and attributes on one scroll viewport', () => {
    const output = renderToString(component(ScrollArea, {label:'Messages',height:120,id:'viewport',style:ifDefined('width:200px;'), 'data-test':'scroll'}, 'Content'));
    expect(output.match(/<div/g)).toHaveLength(1);
    for (const attr of ['id="viewport"','aria-label="Messages"','role="region"','tabindex="0"','height:120px;overflow:auto;width:200px;','data-test="scroll"']) expect(output).toContain(attr);
    expect(output).not.toMatch(/\s(?:height|label)=/);
});
it('allows explicit focus removal and authored sizing overrides', () => {
    const output = renderToString(component(ScrollArea, {label:'Log',height:'50vh',tabindex:-1,style:'height:10rem;'}));
    expect(output).toContain('tabindex="-1"');expect(output).toContain('height:50vh;overflow:auto;height:10rem;');
    expect(renderToString(component(ScrollArea,{label:'Log'}))).toContain('height:auto;overflow:auto;');
});
it.each([-1,NaN,Infinity,'',null])('rejects invalid height %s',height=>{
    expect(()=>renderToString(component(ScrollArea,{label:'Log',height} as any))).toThrow('ScrollArea height');
});
it.each(['', '  ', undefined])('requires a region name %s',label=>{
    expect(()=>renderToString(component(ScrollArea,{label} as any))).toThrow('ScrollArea requires');
});
