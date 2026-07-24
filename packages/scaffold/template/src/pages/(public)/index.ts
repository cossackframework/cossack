import { Client, ClientState, Cossack, Page, Server, State } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Chat, type ChatMessage } from '../../components/Chat';

@Page({ transport: 'sse', scope: () => 'home-chat-demo' })
export default class IndexPage extends Cossack {
    @State() messages: ChatMessage[] = [];
    @State() streamingText = '';
    @State() isStreaming = false;
    @ClientState() inputValue = 'What is Cossack framework?';

    @Client()
    handleInput(event: Event) {
        this.inputValue = (event.target as HTMLInputElement).value;
    }

    @Client()
    handleSubmit(event: Event) {
        event.preventDefault();
        const text = this.inputValue.trim();
        if (!text || this.isStreaming) return;
        this.inputValue = '';
        this.sendMessage(text);
    }

    @Server()
    async *sendMessage(text: string) {
        const message = text.trim();
        if (!message || this.isStreaming) return;

        this.messages = [...this.messages, { role: 'user', content: message }];
        this.streamingText = '';
        this.isStreaming = true;

        const chunks = [
            'A full-stack TypeScript framework for building edge first, real-time web applications.\n\n',
            'Write client and server logic in the same class seamlessly. ',
            'Cossack automatically handles state management, SSR, and security.\n\n',
            'Think of it like Laravel + Next.js + Phoenix LiveView, but TypeScript native and edge deployment ready.',
        ];
        for (const chunk of chunks) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            this.streamingText += chunk;
            yield chunk;
        }

        this.messages = [...this.messages, { role: 'assistant', content: this.streamingText.trim() }];
        this.streamingText = '';
        this.isStreaming = false;
    }

    render() {
        return html`
            <div class="mx-auto max-w-6xl px-4 py-16 sm:py-24">
                <div class="text-center space-y-5">
                    <h1 class="text-4xl sm:text-6xl font-bold tracking-tight text-foreground">${__('Cossack')}</h1>
                    <p class="mx-auto max-w-2xl text-lg sm:text-xl text-muted-foreground">${__('The Borderless TypeScript Framework')}</p>
                </div>
                <div class="mt-12">
                    ${component(Chat, {
                        messages: this.messages,
                        streamingText: this.streamingText,
                        isStreaming: this.isStreaming,
                        inputValue: this.inputValue,
                        onInput: this.handleInput,
                        onSubmit: this.handleSubmit,
                    })}
                </div>
            </div>
        `;
    }
}
