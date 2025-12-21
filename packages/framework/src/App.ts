import { Cossack, Page, State } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export class App extends Cossack {
    @State() theme: 'light' | 'dark' = 'light';

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        // In a real app, you might save this preference to cookies or localStorage
        if (!this.isServer) {
            document.body.className = this.theme;
        }
    }

    template(children: TemplateResult) {
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
                ${children}
            </div>
        `;
    }
}
