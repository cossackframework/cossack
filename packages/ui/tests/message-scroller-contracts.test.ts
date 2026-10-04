import { expect, it } from 'vitest';
import { component, html, renderToString, ifDefined } from '@cossackframework/renderer';
import { MessageScroller, type MessageScrollerProps } from '../src/components/MessageScroller';
const props: MessageScrollerProps = {id:'messages',label:'Conversation'};
it('renders a named native keyboard viewport and preserves independent content',()=>{
    const output=renderToString(component(MessageScroller,{...props,'data-root':'root',class:'custom',style:'height:200px',viewportProps:{'data-viewport':'messages',style:ifDefined('color:red;')}},html`<button type="button">Reply</button>`));
    for(const value of ['id="messages"','id="messages-viewport"','role="region"','aria-label="Conversation"','tabindex="0"','data-root="root"','data-viewport="messages"','height:200px','color:red;','overflow-anchor:none;','custom','<button type="button">Reply</button>'])expect(output).toContain(value);
    expect(output).not.toContain('aria-live');expect(output).not.toContain('cs-message-scroller__jump');expect(output).not.toMatch(/\s(?:label|threshold|initialPosition|viewportProps|jumpProps|jumpLabel)=/);
});
it.each([{id:''},{id:'bad id'},{label:''},{label:undefined},{jumpLabel:''},{threshold:-1},{threshold:NaN},{threshold:Infinity},{threshold:'80'},{initialPosition:'middle'}])('rejects invalid MessageScroller props %j',patch=>{
    expect(()=>renderToString(component(MessageScroller,{...props,...patch} as any))).toThrow('MessageScroller');
});
it('accepts zero threshold and explicit initial start without executing browser work on the server',()=>{
    expect(renderToString(component(MessageScroller,{...props,threshold:0,initialPosition:'start'}))).toContain('messages-viewport');
    const instance=new MessageScroller();instance.props=props;expect(()=>{instance.scrollToBottom();instance.onCleanup();}).not.toThrow();
});
