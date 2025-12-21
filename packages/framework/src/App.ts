import { Cossack, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export class App extends Cossack {
    template(children: TemplateResult) {
        return html`
            <div id="app-wrapper">
                ${children}
            </div>
        `;
    }
}
