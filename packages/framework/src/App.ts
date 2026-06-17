import { Cossack, Page, State, HeadContext, HeadValue, ClientState, On } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export class App extends Cossack {
    @State() theme: 'light' | 'dark' = 'light';

    @ClientState()
    lastNavigatedPath: string = '/';

    @On('navigate-complete')
    logNavigation(pathname: string) {
        // @On('navigate-complete') only fires on the App component, mirroring
        // the onNavigateComplete() hook. Multiple handlers are supported.
        this.lastNavigatedPath = pathname;
    }

    public head(context: HeadContext): HeadValue {
        return {
            title: `Cossack Framework - ${context.title || 'Welcome'}`,
            meta: [
                { tag: 'meta', attributes: { name: 'viewport', content: 'width=device-width, initial-scale=1' } },
            ]
        };
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        if (!this.isServer) {
            document.body.className = this.theme;
        }
    }

    render() {
        return html`
            <div id="app-wrapper" class="${this.theme}">
                <div style="position: fixed; bottom: 20px; right: 20px; z-index: 1000;">
                    <button 
                        @click=${() => this.toggleTheme()}
                        style="padding: 8px 16px; border-radius: 20px; border: 1px solid #ccc; background: white; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2);"
                    >
                        ${this.theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
                    </button>
                </div>
                ${this.children}
            </div>
        `;
    }
}