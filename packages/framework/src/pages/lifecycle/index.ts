import { Cossack, Page, Client, State, html } from '@cossackframework/core';

/**
 * LifecycleDemo - Demonstrates loading states in Cossack
 *
 * This page shows two different loading mechanisms:
 *
 * 1. loading.ts (file-based convention):
 *    - Shown instantly during client-side navigation
 *    - Displays while init() runs on the server
 *    - See: /src/pages/lifecycle/loading.ts
 *
 * 2. loadingTemplate() (method-based convention):
 *    - Shown when this.loading.init is true
 *    - Used for "Refresh Data" button (reload() calls init())
 */
@Page()
export default class LifecycleDemo extends Cossack {
    @State()
    data: string[] = [];

    /**
     * Server-side initialization (runs during SSR)
     * Simulates slow data fetching to demonstrate loading.ts
     */
    async init() {
        // Simulate slow server-side data fetch
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.data = ['Cossack', 'Hono', 'Cloudflare', 'Durable Objects'];
    }

    /**
     * Client-side initialization (runs after hydration on first mount)
     * No @Client decorator needed - clientInit is a built-in method
     *
     * For direct visits, init() already populated the data on the server.
     * This is called after hydration for any client-specific setup.
     */
    async clientInit() {
        // Data is already set by server-side init()
        // Use this for client-only initialization if needed
    }

    @Client()
    async reload() {
        // Call init() to re-fetch from server (RPC call)
        // This triggers loadingTemplate() via this.loading.init state
        await this.init();
    }

    /**
     * Loading template - shown when this.loading.init is true
     * Automatically rendered by the framework during async operations
     */
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
        // Show loading template during async init operations
        if (this.loading.init) {
            return this.loadingTemplate();
        }

        return html`
            <h1>Data Loaded!</h1>
            <p>The initialization logic (init) was called. You can trigger it again manually to see the loading UI.</p>
            <ul>
                ${this.data.map(item => html`<li>${item}</li>`)}
            </ul>
            <button
                @click="${() => this.reload()}"
                style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;"
            >
                Refresh Data (Show Loading UI)
            </button>
        `;
    }
}