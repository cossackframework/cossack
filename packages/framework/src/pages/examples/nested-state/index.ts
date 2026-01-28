import { Cossack, Page } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Page({
    transport: 'durable-object' // Required for stateful components
})
export class NestedStatePage extends Cossack {
    render() {
        return html`
            <div style="padding: 20px;">
                <h1>Nested Stateful Components</h1>
                <p>These counters maintain their own state on the server.</p>
                
                <c:NestedCounter></c:NestedCounter>
                <c:NestedCounter></c:NestedCounter>
                <c:NestedCounter></c:NestedCounter>
            </div>
        `;
    }
}
