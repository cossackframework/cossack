import { Cossack, Component, State, Server } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Component()
export class NestedCounter extends Cossack {
    @State() count = 0;

    @Server()
    increment() {
        console.log(`[NestedCounter] ORIGINAL increment method called - THIS MEANS PROXY FAILED! Count: ${this.count}`);
        this.count++;
        console.log(`[NestedCounter] count incremented to ${this.count}`);
    }

    render() {
        return html`
            <div style="border: 1px solid blue; padding: 10px; margin: 10px 0; display: inline-block;">
                <h4>Nested Counter</h4>
                <p>Count: ${this.count}</p>
                <button @click="${this.increment}">Increment</button>
            </div>
        `;
    }
}
