import { Cossack, Page, ClientState, Client, Server, State, Debounce, Throttle, RateLimit } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Layout } from '@/components/Layout';

@Page({
    transport: 'http',
})
export default class DebounceDemo extends Cossack {
    @ClientState()
    apiCalls: number = 0;

    @ClientState()
    lastQuery: string = '';

    @ClientState()
    rawKeystrokes: number = 0;

    @ClientState()
    throttleClicks: number = 0;

    // --- Server-side debounced search -------------------------------------
    // @State is synced server -> client, so the UI updates once the RPC returns.
    @State()
    serverApiCalls: number = 0;

    @State()
    serverLastQuery: string = '';

    @State()
    serverResults: string[] = [];

    @ClientState()
    serverKeystrokes: number = 0;

    // --- Server-side rate limiting (abuse protection) ---------------------
    // Unlike the client-side @Debounce above (which is UX — a malicious client
    // can bypass it), @RateLimit runs on the SERVER and hard-rejects excess
    // calls with HTTP 429. Here each caller is capped at 3 saves per 10s.
    @State()
    saveAttempts: number = 0;

    @Client()
    requestSave() {
        this.guardedSave();
    }

    @Server()
    @RateLimit({ window: 10_000, max: 3 })
    async guardedSave() {
        // Only the first 3 calls per 10s per caller actually run on the server;
        // the rest are rejected at the /crpc dispatch boundary before reaching here.
        this.saveAttempts++;
    }

    @Client()
    handleInput(e: InputEvent) {
        // Count every keystroke — the debounced method only fires once per pause.
        this.rawKeystrokes++;
        this.search((e.target as HTMLInputElement).value);
    }

    @Client()
    @Debounce(500)
    search(query: string) {
        // Simulates an API call — only the final query (after 500ms of inactivity)
        // actually executes, no matter how many keystrokes preceded it.
        this.apiCalls++;
        this.lastQuery = query;
        console.log('[DebounceDemo] client search API called with:', query);
    }

    @Client()
    handleServerInput(e: InputEvent) {
        // Each keystroke increments the local counter and kicks the debounced
        // RPC proxy. Rapid typing results in at most one server request per pause.
        this.serverKeystrokes++;
        this.searchServer((e.target as HTMLInputElement).value);
    }

    /**
     * Runs on the server. Because it is also `@Debounce(500)`, the CLIENT-side
     * RPC proxy is wrapped so that rapid calls collapse into a single network
     * request — only the last query reaches the server. Results are written to
     * `@State` (the RPC return value is discarded by the debounce wrapper), then
     * synced back to the client automatically.
     */
    @Server()
    @Debounce(500)
    async searchServer(query: string) {
        this.serverApiCalls++;
        this.serverLastQuery = query;
        const pool = [
            'apple', 'apricot', 'banana', 'blueberry', 'cherry',
            'date', 'elderberry', 'fig', 'grape', 'kiwi',
        ];
        const q = query.trim().toLowerCase();
        this.serverResults = q ? pool.filter((fruit) => fruit.includes(q)) : pool;
    }

    @Client()
    @Throttle(1000)
    countedClick() {
        // Runs at most once per second, even if the button is smashed.
        this.throttleClicks++;
        console.log('[DebounceDemo] throttled click registered');
    }

    render() {
        return component(Layout, { dir: 'ltr' }, html`
            <div class="p-5 border-2 border-dashed border-gray-300 m-5">
                <h1>Debounce &amp; Throttle Demo</h1>
                <p>
                    <code>@Debounce(ms)</code> coalesces rapid calls into a single trailing
                    invocation; <code>@Throttle(ms)</code> runs at most once per window.
                </p>

                <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-5 mt-5">
                    <div class="p-4 bg-blue-50 rounded-lg">
                        <h3>@Debounce(500) search</h3>
                        <input
                            class="border border-gray-400 rounded px-2 py-1 w-full"
                            @input=${(e: InputEvent) => this.handleInput(e)}
                            placeholder="Type to search..."
                        />
                        <p class="mt-2">Keystrokes: <strong>${this.rawKeystrokes}</strong></p>
                        <p>API calls: <strong class="text-blue-800 text-[1.5em]">${this.apiCalls}</strong></p>
                        <p>Last query: <strong>${this.lastQuery || '—'}</strong></p>
                    </div>

                    <div class="p-4 bg-purple-50 rounded-lg">
                        <h3>@Server() @Debounce(500) search</h3>
                        <input
                            class="border border-gray-400 rounded px-2 py-1 w-full"
                            @input=${(e: InputEvent) => this.handleServerInput(e)}
                            placeholder="Type to query the server..."
                        />
                        <p class="mt-2">Keystrokes: <strong>${this.serverKeystrokes}</strong></p>
                        <p>Server API calls: <strong class="text-purple-800 text-[1.5em]">${this.serverApiCalls}</strong></p>
                        <p>Last server query: <strong>${this.serverLastQuery || '—'}</strong></p>
                        <p class="mt-2">Results:</p>
                        <ul class="list-disc list-inside text-sm text-purple-900">
                            ${this.serverResults.map((fruit) => html`<li>${fruit}</li>`)}
                        </ul>
                    </div>

                    <div class="p-4 bg-green-50 rounded-lg">
                        <h3>@Throttle(1000) click</h3>
                        <button
                            class="border border-gray-400 rounded px-3 py-1 bg-white"
                            @click=${() => this.countedClick()}
                        >
                            Smash me
                        </button>
                        <p class="mt-2">Registered clicks (max 1/sec):</p>
                        <strong class="text-[2em] text-green-800">${this.throttleClicks}</strong>
                    </div>

                    <div class="p-4 bg-red-50 rounded-lg">
                        <h3>@Server() @RateLimit(max:3 / 10s)</h3>
                        <button
                            class="border border-gray-400 rounded px-3 py-1 bg-white"
                            @click=${() => this.requestSave()}
                        >
                            Save (server)
                        </button>
                        <p class="mt-2">Successful server saves (3 per 10s, then 429):</p>
                        <strong class="text-[2em] text-red-800">${this.saveAttempts}</strong>
                        <p class="text-xs text-gray-600 mt-1">
                            Unlike client debounce, this is enforced server-side —
                            a malicious client cannot bypass it.
                        </p>
                    </div>
                </div>

                <p class="mt-5 italic text-gray-500">
                    Tip: type quickly and watch <em>API calls</em> stay far below
                    <em>Keystrokes</em>; the purple card does the same against a real
                    <code>@Server</code> RPC (debounced on the client, so the server sees
                    one request per pause); spam the button and watch
                    <em>Registered clicks</em> tick at most once per second.
                </p>
            </div>
        `);
    }
}
