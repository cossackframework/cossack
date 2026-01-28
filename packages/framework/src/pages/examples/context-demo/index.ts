import { Cossack, Page } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Page()
export class ContextDemoPage extends Cossack {
    render() {
        return html`
            <div style="padding: 20px;">
                <h1>Context API Demo</h1>
                <p>This page demonstrates how nested components access global context.</p>
                <c:ContextCard></c:ContextCard>
            </div>
        `;
    }
}
