import { Cossack, Page, State, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class IndexPage extends Cossack {
    @State() count = 0;

    @Server()
    increment() {
        this.count++;
    }

    render() {
        return html`
            <h1>Hello Cossack!</h1>
            <p>Count: ${this.count}</p>
            <button @click=${this.increment}>Increment</button>
        `;
    }
}
