import { ClientState, Cossack, createStore, connectStore } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

export const messages = createStore<string[]>([]);
export function showMessage(message: string) { messages.update(current => [...current, message]); }

export class Messages extends Cossack {
    @ClientState() items: string[] = [];
    private disconnect?: () => void;
    onMount() { this.disconnect = connectStore(messages, this, 'items'); }
    onCleanup() { this.disconnect?.(); }
    render() { return html`<ul>${this.items.map(item => html`<li>${item}</li>`)}</ul>`; }
}
