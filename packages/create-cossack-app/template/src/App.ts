import { Cossack, Page, State, HeadContext, HeadValue } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export class App extends Cossack {
    @State() theme: 'light' | 'dark' = 'light';

    public head(context: HeadContext): HeadValue {
        return {
            title: `My Cossack App - ${context.title || 'Welcome'}`,
            meta: [
                { tag: 'meta', attributes: { name: 'viewport', content: 'width=device-width, initial-scale=1' } },
            ]
        };
    }

    render() {
        return html`
            <div id="app-wrapper" class="${this.theme} min-h-screen bg-gray-50 text-gray-900 antialiased">
                ${this.children}
            </div>
        `;
    }
}
