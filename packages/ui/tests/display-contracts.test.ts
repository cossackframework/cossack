import { expect, it } from 'vitest';
import { component, html, renderToString, ifDefined } from '@cossackframework/renderer';
import { Skeleton } from '../src/components/Skeleton';
import { Card, CardHeader, CardBody, CardFooter } from '../src/components/Card';
import { Badge } from '../src/components/Badge';
import { Kbd } from '../src/components/Kbd';

it('renders visible default skeleton dimensions and distinct circle sizing',()=>{
    const line=renderToString(component(Skeleton,{id:'line'}));expect(line).toContain('width:100%;height:1em');expect(line).toContain('aria-hidden="true"');expect(line).toContain('motion-reduce:animate-none');
    const circle=renderToString(component(Skeleton,{circle:true,size:40}));expect(circle).toContain('width:40px;height:40px');expect(circle).toContain('rounded-full');expect(circle).not.toMatch(/\s(?:circle|size)=/);
    expect(renderToString(component(Skeleton,{width:'calc(100% - 1rem)',height:0}))).toContain('height:0px');
});
it.each([{circle:true,width:40},{size:40},{width:-1},{height:Infinity},{width:''},{circle:true,size:NaN},{circle:'yes'}])('rejects invalid skeleton dimensions/modes',props=>{
    expect(()=>renderToString(component(Skeleton,props as any))).toThrow('Skeleton');
});
it('types and forwards every Card slot without leaking visual options',()=>{
    const output=renderToString(component(Card,{id:'card',padding:'none',hoverable:true,'data-card':'root'},html`${component(CardHeader,{id:'header'},'Title')}${component(CardBody,{id:'body'},'Content')}${component(CardFooter,{id:'footer'},'Actions')}`));
    for(const id of ['card','header','body','footer'])expect(output).toContain(`id="${id}"`);
    expect(output).toContain('hover:shadow-md');expect(output).toContain('motion-reduce:hover:translate-y-0');expect(output).not.toContain('cursor-pointer');expect(output).not.toMatch(/\s(?:padding|hoverable)=/);expect(output).not.toContain('role="button"');
});
it('rejects unsupported visual variants',()=>{
    expect(()=>renderToString(component(Card,{padding:'huge'} as any))).toThrow('Card');
    expect(()=>renderToString(component(Badge,{variant:'__proto__'} as any))).toThrow('Badge');
});
it('preserves native badge and keyboard text semantics',()=>{
    const badge=renderToString(component(Badge,{variant:'success',id:'status','data-state':'saved'},'Saved'));expect(badge).toContain('<span');expect(badge).toContain('id="status"');expect(badge).toContain('Saved');expect(badge).not.toMatch(/\svariant=/);
    const kbd=renderToString(component(Kbd,{id:'key',title:'Control key'},'Ctrl'));expect(kbd).toContain('<kbd');expect(kbd).toContain('title="Control key"');expect(kbd).not.toContain('tabindex');
});

it('composes native skeleton styles and optional style directives with dimensions',()=>{
    for(const style of ['opacity:0.75',ifDefined('opacity:0.75')]) {
        const output=renderToString(component(Skeleton,{style}));expect(output).toContain('width:100%;height:1em;opacity:0.75');
    }
    expect(renderToString(component(Skeleton,{style:ifDefined(undefined)}))).toContain('width:100%;height:1em');
});
