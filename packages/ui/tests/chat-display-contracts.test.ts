import { expect, it } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
import { Bubble } from '../src/components/Bubble';
import { Message } from '../src/components/Message';
import { Marker } from '../src/components/Marker';
import type { GlobalAttributes } from '../src/native-attributes';

it.each([
    (props: GlobalAttributes<HTMLDivElement>) => component(Bubble, props, 'Text'),
    (props: GlobalAttributes<HTMLDivElement>) => component(Message, props, 'Text'),
    (props: GlobalAttributes<HTMLDivElement>) => component(Marker, props, 'Text'),
])('forwards root native props without creating an action', template => {
    const output = renderToString(template({id:'root','data-message':'one','aria-describedby':'context',dir:'rtl',class:'custom',style:'color:red'}));
    for (const part of ['id="root"','data-message="one"','aria-describedby="context"','dir="rtl"','custom','color:red','Text']) expect(output).toContain(part);
    expect(output).not.toContain('role="button"');expect(output).not.toContain('tabindex=');
});
it.each(['sent','received'] as const)('retains all authored %s metadata, avatar and child actions', variant => {
    const output=renderToString(component(Message,{variant,name:'Alice',time:'Morning',datetime:'2026-10-04T10:30:00+07:00',avatar:html`<span>Portrait</span>`},
        component(Bubble,{variant},html`<button type="button">Reply</button>`)));
    for(const text of ['Alice','Morning','<time datetime="2026-10-04T10:30:00+07:00">','Portrait','<button type="button">Reply</button>'])expect(output).toContain(text);
    expect(output).not.toMatch(/\s(?:variant|name|avatar)=/);
});
it('gives reactions explicit text equivalents and preserves zero counts',()=>{
    const output=renderToString(component(Bubble,{reactionsLabel:'Réactions',reactions:[{emoji:'👍',label:'Like',count:0},{emoji:'🎉',label:'Celebrate'}]},'Message'));
    expect(output).toContain('<ul aria-label="Réactions"');expect(output.match(/<li /g)).toHaveLength(2);
    expect(output).toContain('<span aria-hidden="true">👍</span>');expect(output).toContain('Like');expect(output).toMatch(/>0<\/span>/);
    expect(output).not.toContain('<button');expect(output).not.toContain('absolute');expect(output).not.toContain('aria-live');
});
it.each([Bubble,Message])('keeps arbitrary display time text ordinary without explicit datetime for %s',Component=>{
    const output=renderToString(component(Component,{time:'Just now'},'Text'));expect(output).toContain('Just now');expect(output).not.toContain('<time');
    const timed=renderToString(component(Component,{time:'10:30 AM',datetime:'10:30'},'Text'));expect(timed).toContain('<time datetime="10:30">10:30 AM</time>');
});
it('hides only the decorative marker lines and retains readable inline children',()=>{
    const output=renderToString(component(Marker,{variant:'unread'},html`<strong>New messages</strong>`));
    expect(output.match(/aria-hidden="true"/g)).toHaveLength(2);expect(output).toContain('<strong>New messages</strong>');
    expect(output).not.toContain('role="separator"');expect(output).not.toContain('aria-live');expect(output).not.toMatch(/\svariant=/);
});
it.each(['default','pill','square'] as const)('renders %s Bubble styling without discarding native child content',shape=>{
    const output=renderToString(component(Bubble,{shape,variant:'sent'},html`<a href="/record">Record</a>`));
    expect(output).toContain('<a href="/record">Record</a>');expect(output).not.toMatch(/\s(?:shape|reactions|reactionsLabel|time)=/);
});
it.each([{variant:'wrong'},{shape:'wrong'},{time:7},{datetime:'10:30'},{time:'Now',datetime:''},{reactionsLabel:''},{reactions:null},
    {reactions:[{emoji:'👍'}]},{reactions:[{emoji:'',label:'Like'}]},{reactions:[{emoji:'👍',label:' '}]}])('rejects invalid Bubble options %j',props=>{
    expect(()=>renderToString(component(Bubble,props as any,'Text'))).toThrow('Bubble');
});
it.each([-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'2'])('rejects invalid reaction count %s',count=>{
    expect(()=>renderToString(component(Bubble,{reactions:[{emoji:'👍',label:'Like',count}]} as any))).toThrow('counts');
});
it.each([{variant:'wrong'},{name:7},{time:7},{datetime:'10:30'},{time:'Now',datetime:''}])('rejects invalid Message options %j',props=>{
    expect(()=>renderToString(component(Message,props as any))).toThrow('Message');
});
it('rejects unknown marker variants',()=>{
    expect(()=>renderToString(component(Marker,{variant:'wrong'} as any,'Date'))).toThrow('Marker');
});
