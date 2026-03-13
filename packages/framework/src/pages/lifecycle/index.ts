import { Cossack, Page, Client, State, html } from '@cossackframework/core';

/**
 * LifecycleDemo - Demonstrates loading states in Cossack
 *
 * This page demonstrates convention-based loading:
 *
 * Because this component has a loadingTemplate() method (and a loading.ts file exists),
 * the framework automatically skips init() during SSR and shows the loading UI immediately.
 *
 * Flow:
 * 1. SSR: Render loading template, send HTML immediately (no wait)
 * 2. Client: Hydrate with loading template showing
 * 3. clientInit(): Calls init() via RPC to fetch data from server
 * 4. Data loads: Re-render with actual content
 */
@Page()
export default class LifecycleDemo extends Cossack {
    @State()
    data: string[] = [];

    /**
     * Server-side initialization
     * - Skipped during SSR if loadingTemplate() exists (instant HTML response)
     * - Called via RPC from clientInit() to fetch data
     * - Also called manually via "Refresh Data" button
     */
    async init() {
        // Simulate slow server-side data fetch (DB query, API call, etc.)
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.data = ['Cossack', 'Hono', 'Cloudflare', 'Durable Objects'];
    }

    /**
     * Client-side initialization (runs after hydration)
     * No @Client decorator needed - clientInit is a built-in method
     *
     * Calls init() via RPC to fetch data from the server after loading UI is shown.
     */
    async clientInit() {
        // Fetch data from server via RPC
        // This triggers loading state, shows skeleton, then populates data
        await this.init();
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