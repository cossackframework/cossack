import { Cossack, Page, State, html } from '@cossackframework/core';

@Page()
export default class LifecycleDemo extends Cossack {
    @State()
    data: string[] = [];

    // This method is called by the framework during bootstrap
    async init() {
        // Simulate a slow data fetch (e.g., from D1 or KV)
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.data = ['Cossack', 'Hono', 'Cloudflare', 'Durable Objects'];
    }

    // Convention: If this method exists, it's rendered when this.loading.init is true
    loadingTemplate() {
        return html`
            <style>
                .skeleton { background: #eee; height: 24px; margin-bottom: 12px; border-radius: 4px; animation: pulse 1.5s infinite; }
                @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
            </style>
            <h1>Loading Data...</h1>
            <div class="skeleton" style="width: 60%"></div>
            <div class="skeleton" style="width: 80%"></div>
            <div class="skeleton" style="width: 40%"></div>
            <div class="skeleton" style="width: 70%"></div>
        `;
    }

    render() {
        return html`
            <h1>Data Loaded!</h1>
            <p>The initialization logic (init) was called. You can trigger it again manually to see the loading UI.</p>
            <ul>
                ${this.data.map(item => html`<li>${item}</li>`)}
            </ul>
            <button 
                @click="${() => this.init()}"
                style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;"
            >
                Refresh Data (Show Loading UI)
            </button>
        `;
    }
}