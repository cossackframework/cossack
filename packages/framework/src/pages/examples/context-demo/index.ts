import { Cossack, Page } from "@cossackframework/core";
import { html, component } from "@cossackframework/renderer";
import { ContextCard } from "@/components/ContextCard";

@Page()
export class ContextDemoPage extends Cossack {
    render() {
        return html`
            <div class="p-5">
                <h1>Context API Demo</h1>
                <p>This page demonstrates how nested components access global context.</p>
                ${component(ContextCard)}
            </div>
        `;
    }
}
