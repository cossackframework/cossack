import { Cossack, Page } from "@cossackframework/core";
import { html, component } from "@cossackframework/renderer";
import { NestedCounter } from "@/components/NestedCounter";

@Page({
    transport: 'durable-object',
    stateful: true,
})
export class NestedStatePage extends Cossack {
    render() {
        return html`
            <div class="p-5">
                <h1>Nested Stateful Components</h1>
                <p>These counters maintain their own state on the server.</p>

                ${component(NestedCounter)}
                ${component(NestedCounter)}
                ${component(NestedCounter)}
            </div>
        `;
    }
}
