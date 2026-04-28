import { Cossack, Component, State, Server } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Component({
    transport: 'http'
})
export class NestedCounter extends Cossack {
    @State() count = 0;

    @Server()
    increment() {
        this.count++;
    }

    render() {
        return html`
            <div class="border border-blue-500 p-2.5 my-2.5 inline-block">
                <h4>Nested Counter</h4>
                <p>Count: ${this.count}</p>
                <button @click="${this.increment}" class="border border-gray-300 px-3 py-1 cursor-pointer">Increment</button>
            </div>
        `;
    }
}
