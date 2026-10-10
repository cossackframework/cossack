import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { Pagination } from '../src/components/Pagination';

const draw = (props: any) => renderToString(component(Pagination, { page: 5, totalPages: 10, onPageChange: () => {}, ...props }));
it('renders a bounded, named native button window and consumes component props', () => {
    const output = draw({id:'pages',label:'Results',maxButtons:3,'data-source':'search',buttonProps:{title:'Select'}});
    expect(output).toContain('aria-label="Results"');
    expect(output).toContain('id="pages"');
    expect(output).toContain('data-source="search"');
    expect(output.match(/<button\b/g)).toHaveLength(7);
    expect(output).toContain('aria-label="Page 4"');
    expect(output).toContain('aria-label="Page 6"');
    expect(output).not.toContain('aria-label="Page 3"');
    expect(output.match(/aria-current="page"/g)).toHaveLength(1);
    expect(output).toContain('title="Select"');
    expect(output).not.toMatch(/\s(?:page|totalPages|maxButtons|label|onPageChange|buttonProps)=/);
});
it('clamps a stale controlled page after count reduction without emitting changes', () => {
    let changes = 0;
    const output = draw({page:99,totalPages:2,onPageChange:()=>changes++});
    expect(output).toMatch(/aria-label="Page 2"[^>]*aria-current="page"/);
    expect(output).toMatch(/disabled[^>]*aria-label="Next page"/);
    expect(changes).toBe(0);
});
it('renders empty counts without a current page or page buttons', () => {
    const output = draw({totalPages:0});
    expect(output.match(/<button\b/g)).toHaveLength(2);
    expect(output.match(/disabled/g)).not.toBeNull();
    expect(output).not.toContain('aria-current="page"');
});
it('renders native URL links and omits URLs for disabled controls', () => {
    const output = renderToString(component(Pagination,{page:1,totalPages:2,href:page=>`/results?page=${page}`,linkProps:{target:'_blank',rel:'noopener'},pageLabel:page=>`Result ${page}`}));
    expect(output).toContain('href="/results?page=2"');
    expect(output).toContain('aria-label="Result 1"');
    expect(output).toContain('aria-disabled="true"');
    expect(output).toContain('target="_blank"');
    expect(output).not.toContain('<button');
    expect(output).not.toContain('href="/results?page=0"');
});
it('bounds rendering for a safe-integer page count', () => {
    const output = draw({page:Number.MAX_SAFE_INTEGER,totalPages:Number.MAX_SAFE_INTEGER,maxButtons:1});
    expect(output.match(/<button\b/g)).toHaveLength(4);
    expect(output).toContain(`aria-label="Page ${Number.MAX_SAFE_INTEGER}"`);
});
it.each([{page:0},{page:1.5},{page:Infinity},{totalPages:-1},{totalPages:0.5},{totalPages:NaN},{totalPages:Number.MAX_SAFE_INTEGER+1},{maxButtons:0},{maxButtons:101},{maxButtons:2.5},{label:''},{previousLabel:''},{nextLabel:''},{pageLabel:()=>''},{onPageChange:undefined},{href:():string=>'/page'},{href:():string=>'',onPageChange:undefined},{href:():string=>'/page',onPageChange:undefined,buttonProps:{}},{linkProps:{}}])('rejects invalid pagination contracts: %j', props => {
    expect(()=>draw(props)).toThrow('Pagination');
});
