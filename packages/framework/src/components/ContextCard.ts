import { Cossack, Component } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Component()
export class ContextCard extends Cossack {
    render() {
        console.log('[ContextCard] c:', this.c, 'req:', this.c?.req, 'path:', this.c?.req?.path);
        return html`
            <div style="border: 1px solid #ccc; padding: 10px; margin: 10px 0;">
                <h3>Context Access from Nested Component</h3>
                <p><strong>User:</strong> ${this.user?.name || 'Guest'} (${this.user?.id})</p>
                <p><strong>Path (Request Context):</strong> ${this.c?.req.path}</p>
                <p><strong>Env (Mock):</strong> ${this.env ? 'Available' : 'Not Available'}</p>
            </div>
        `;
    }
}
