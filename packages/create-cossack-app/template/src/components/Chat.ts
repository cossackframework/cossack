import { __, Component, Cossack } from '@cossackframework/core';
import { Bubble, Button, Card, CardBody, CardHeader, Icon, Input, Message, MessageScroller } from '@cossackframework/ui';
import { ArrowUpIcon as arrowUpIcon } from '@cossackframework/solar-icons/arrow-up';
import { component, html } from '@cossackframework/renderer';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatProps {
    messages: ChatMessage[];
    streamingText: string;
    isStreaming: boolean;
    inputValue: string;
    onInput: (event: Event) => void;
    onSubmit: (event: Event) => void;
}

@Component()
export class Chat extends Cossack {
    declare props: ChatProps;

    render() {
        const { messages, streamingText, isStreaming, inputValue, onInput, onSubmit } = this.props;
        return component(Card, { class: 'mx-auto max-w-2xl overflow-hidden' }, html`
            ${component(CardHeader, {}, html`
                <h2 class="text-xl font-semibold text-foreground">${__('Live Chat')}</h2>
                <p class="mt-1 text-sm text-muted-foreground">${__('Send a message and watch the shared server response arrive incrementally.')}</p>
            `)}
            ${component(CardBody, { class: 'space-y-4' }, html`
                <div class="h-80 overflow-hidden rounded-lg border border-border bg-muted/20" aria-live="polite">
                    ${component(MessageScroller, {}, html`
                        ${messages.length === 0 ? html`<p class="py-24 text-center text-sm text-muted-foreground">${__('No messages yet. Ask the suggested question!')}</p>` : ''}
                        ${messages.map((message) => component(
                            Message,
                            { name: message.role === 'assistant' ? __('Cossack') : undefined, variant: message.role === 'user' ? 'sent' : 'received' },
                            component(Bubble, { variant: message.role === 'user' ? 'sent' : 'received' }, html`<span class="whitespace-pre-wrap">${message.content}</span>`),
                        ))}
                        ${isStreaming ? component(
                            Message,
                            { name: __('Cossack'), variant: 'received' },
                            component(Bubble, { variant: 'received' }, html`<span class="whitespace-pre-wrap">${streamingText}</span><span class="animate-pulse">▌</span>`),
                        ) : ''}
                    `)}
                </div>
                <form @submit=${onSubmit} class="flex items-center gap-2">
                    <div class="min-w-0 flex-1">
                        ${component(Input, {
                            type: 'text',
                            required: true,
                            '.value': inputValue,
                            '@input': onInput,
                            disabled: isStreaming,
                            placeholder: __('Ask the demo anything…'),
                            'aria-label': __('Chat message'),
                        })}
                    </div>
                    ${component(Button, {
                        type: 'submit',
                        size: 'icon',
                        disabled: isStreaming,
                        'aria-label': isStreaming ? __('Streaming response') : __('Send message'),
                        title: isStreaming ? __('Streaming response') : __('Send message'),
                    }, component(Icon, { entry: arrowUpIcon, size: 18 }))}
                </form>
            `)}
        `);
    }
}
