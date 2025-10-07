import { Cossack, Page, Server, State } from "@cossackframework/core";
import { TemplateResult } from "@cossackframework/renderer";
import { html } from "@cossackframework/renderer";

@Page({
    transport: 'http'
})
export class CounterHttp extends Cossack {
    @State()
    count = 0;

    async init() {
        // This now runs on the server during the initial GET request.
        // The client will hydrate with this initial state.
        this.count = 0;
    }

    @Server()
    increment() {
        this.count++;
    }

    @Server()
    decrement() {
        this.count--;
    }

    protected template(): TemplateResult | null {
        return html`
            <div>
                <h1>Counter (HTTP)</h1>
                <p>Count: ${this.count}</p>
                <button @click=${this.decrement}>-</button>
                <button @click=${this.increment}>+</button>
            </div>
        `;
    }
}
