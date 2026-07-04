import { Cossack, Page, Server, State, Client, ClientState, HeadContext, HeadValue } from "@cossackframework/core";
import { TemplateResult, html } from "@cossackframework/renderer";

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

@Page({
    transport: 'sse',
    scope: (c) => {
        return `room:${c.req.query('room')}`
    }
})
export class SseChat extends Cossack {
    @State()
    messages: ChatMessage[] = [];

    @State()
    streamingText: string = '';

    @State()
    isStreaming: boolean = false;

    @ClientState()
    inputValue: string = '';

    public head(context: HeadContext): HeadValue {
        return {
            title: 'SSE Chat'
        };
    }

    async init() {
        this.messages = [];
    }

    @Client()
    handleInput(e: Event) {
        this.inputValue = (e.target as HTMLInputElement).value;
    }

    @Client()
    handleSubmit(e: Event) {
        e.preventDefault();
        // Read the text directly from the form's input at submit time. The
        // controlled `.value=${this.inputValue}` binding can re-render mid-typing
        // and leave `this.inputValue` stale, truncating multi-word messages.
        const form = e.target as HTMLFormElement;
        const input = form.querySelector('input[type="text"]') as HTMLInputElement;
        const text = (input?.value ?? this.inputValue).trim();
        if (!text || this.isStreaming) return;
        this.inputValue = '';
        if (input) input.value = '';
        // Server mutates state (messages, streamingText, isStreaming);
        // SSE pushes state updates to this client automatically.
        this.sendMessage(text);
    }

    @Server()
    async *sendMessage(text: string) {
        if (!text.trim()) return;
        this.messages = [...this.messages, { role: 'user', content: text.trim() }];
        this.isStreaming = true;
        this.streamingText = '';

        const sentences = [
            "Hello! I'm a Cossack SSE chat demo. ",
            "Your message was sent via HTTP POST, but my response is being streamed through Server-Sent Events. ",
            "Each sentence arrives one second after the previous one. ",
            "This works on plain Workers — no Durable Object or WebSocket required. ",
            "Open another tab to see the same stream broadcast in real time!",
        ];

        for (const sentence of sentences) {
            await new Promise(r => setTimeout(r, 200));
            this.streamingText += sentence;
            yield sentence;
        }

        this.messages = [...this.messages, { role: 'assistant', content: this.streamingText }];
        this.streamingText = '';
        this.isStreaming = false;
    }

    render(): TemplateResult | null {
        return html`
            <style>
                .sse-chat { max-width: 600px; margin: 0 auto; font-family: system-ui, sans-serif; }
                .sse-chat h1 { font-size: 1.25rem; margin-bottom: 1rem; }
                .sse-chat .messages { border: 1px solid #e0e0e0; border-radius: 8px; padding: 1rem;
                    min-height: 200px; max-height: 400px; overflow-y: auto; background: #fafafa; }
                .sse-chat .msg { margin-bottom: 0.75rem; }
                .sse-chat .msg.user { text-align: right; }
                .sse-chat .msg .bubble { display: inline-block; padding: 0.5rem 0.75rem;
                    border-radius: 12px; max-width: 80%; word-break: break-word; }
                .sse-chat .msg.user .bubble { background: #007bff; color: #fff; }
                .sse-chat .msg.assistant .bubble { background: #e9ecef; color: #333; }
                .sse-chat .streaming .bubble .cursor { animation: blink 1s step-end infinite; }
                @keyframes blink { 50% { opacity: 0; } }
                .sse-chat form { display: flex; gap: 0.5rem; margin-top: 1rem; }
                .sse-chat input { flex: 1; padding: 0.5rem; border: 1px solid #ccc;
                    border-radius: 6px; font-size: 1rem; }
                .sse-chat button { padding: 0.5rem 1rem; border: none; border-radius: 6px;
                    background: #007bff; color: #fff; cursor: pointer; font-size: 1rem; }
                .sse-chat button:disabled { opacity: 0.5; cursor: not-allowed; }
            </style>
            <div class="sse-chat">
                <h1>SSE Chat</h1>
                <div class="messages">
                    ${this.messages.map((m: ChatMessage) => html`
                        <div class="msg ${m.role}">
                            <span class="bubble">${m.content}</span>
                        </div>
                    `)}
                    ${this.isStreaming ? html`
                        <div class="msg assistant streaming">
                            <span class="bubble">${this.streamingText}<span class="cursor">|</span></span>
                        </div>
                    ` : ''}
                </div>
                <form @submit=${this.handleSubmit}>
                    <input
                        type="text"
                        placeholder="Type a message..."
                        .value=${this.inputValue}
                        @input=${this.handleInput}
                        ?disabled=${this.isStreaming}
                    />
                    <button type="submit" ?disabled=${this.isStreaming}>Send</button>
                </form>
            </div>
        `;
    }
}
