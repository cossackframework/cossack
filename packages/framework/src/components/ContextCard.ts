import { Cossack, Component } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Component()
export class ContextCard extends Cossack {
    render() {
        // Avoid logging the full context object — it contains env bindings
        // (including DurableObjectNamespace) that workerd tries to inspect
        // during console.log serialization, triggering a getExportedHandler error.
        console.log('[ContextCard] path:', this.c?.req?.path);
        return html`
            <div class="border border-gray-300 p-2.5 my-2.5">
                <h3>Context Access from Nested Component</h3>
                <p><strong>User:</strong> ${(this.user as { name?: string } | undefined)?.name || 'Guest'} (${this.user?.id})</p>
                <p><strong>Path (Request Context):</strong> ${this.c?.req.path}</p>
                <p><strong>Env (Mock):</strong> ${this.env ? 'Available' : 'Not Available'}</p>
            </div>
        `;
    }
}
