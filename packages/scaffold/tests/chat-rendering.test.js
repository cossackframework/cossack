import { expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { renderRecipe, resolveRecipe } from '../src/index.js';
import { html, component, renderToString } from '../../renderer/dist/index.js';
import { Bubble, Button, Card, CardBody, CardHeader, Icon, Input, Message, MessageScroller } from '../../ui/dist/index.js';

it('renders the generated chat through real UI components for received, sent and streaming content', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'full-stack' }));
    const source = files.get('src/components/Chat.ts').content.toString();
    const start = source.lastIndexOf('    render() {'); expect(start).toBeGreaterThan(0);
    const method = source.slice(start, source.lastIndexOf('}'));
    const { code } = transformSync(`const chat = { ${method} };`, { loader: 'ts', target: 'es2022' });
    // Real generated method, renderer and UI. Translation, records and callbacks
    // are fixture inputs; this does not exercise a transport or generated server.
    const chat = new Function('html','component','Bubble','Button','Card','CardBody','CardHeader','Icon','Input','Message','MessageScroller','__','arrowUpIcon',code+'\nreturn chat;')(
        html,component,Bubble,Button,Card,CardBody,CardHeader,Icon,Input,Message,MessageScroller,value=>value,{line:'<path d="M1 1h4v4H1z" />'});
    chat.props = { messages:[{role:'user',content:'Question <one>'},{role:'assistant',content:'Answer'}],streamingText:'More text',isStreaming:true,inputValue:'Draft',onInput:()=>{},onSubmit:()=>{} };
    const output = renderToString(chat.render());
    expect(output.match(/class="cs-message /g)).toHaveLength(3);
    expect(output).toContain('cs-message--sent');expect(output).toContain('cs-message--received');
    expect(output).toContain('Question &lt;one&gt;');expect(output).toContain('Answer');expect(output).toContain('More text');
    expect(output).toContain('id="chat-messages-viewport"');expect(output).toContain('aria-label="Conversation"');expect(output.match(/aria-live="polite"/g)).toHaveLength(1);expect(output).toContain('Receiving response');expect(output).toContain('aria-busy="true"');
    expect(output).not.toMatch(/class="h-80[^"]*" aria-live/);
    expect(output).toContain('cs-bubble__body');expect(output).toContain('aria-label="Chat message"');expect(output).toContain('value="Draft"');
    expect(output).toContain('aria-label="Streaming response"');expect(output).toContain('type="submit"');
    chat.props = {...chat.props,messages:[],isStreaming:false,streamingText:''};
    const empty = renderToString(chat.render());expect(empty).toContain('No messages yet.');expect(empty).not.toContain('class="cs-message ');
});
