import { Cossack, Page, State, Server, HeadContext, HeadValue } from '@cossackframework/core';
import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { cache } from '@/cache';
import { Layout } from '@/components/Layout';

// Demonstrates the server-side cache facade. All cache calls live inside a
// `@Server()` method (the cache is server-only, resolved per-request from
// `src/config/cache.ts`). Results are written to `@State` so they render on the
// client. Uses the default in-memory store (zero config).
//
// The demo caches the current datetime, waits a few seconds, then reads it
// back. If the cache works, the read value is the *original* timestamp — not
// the current time — proving the value survived from the write.

@Page({
    transport: 'http',
})
export default class CacheExample extends Cossack {
    // The timestamp written into the cache.
    @State()
    private storedAt: string = '';

    // The timestamp read back from the cache.
    @State()
    private cachedAt: string = '';

    // The actual current time when the read happened, for comparison.
    @State()
    private readAt: string = '';

    // Whether the cached value matched the stored value (cache hit).
    @State()
    private cacheHit: boolean = false;

    // Elapsed milliseconds between write and read (the artificial delay).
    @State()
    private elapsedMs: number = 0;

    head(_context: HeadContext): HeadValue {
        return {
            title: 'Cache Example',
            description: 'Demonstrates the server-side cache facade — caches a datetime, delays, then reads it back.',
        };
    }

    /**
     * Caches the current datetime under a fixed key, waits ~3 seconds, then
     * reads it back. If the cache works, the read value is the original write
     * time (not the current time after the delay).
     */
    @Server()
    async runCacheTest() {
        // 1. Capture the current time and cache it (TTL: 60s — comfortably
        //    longer than the delay below).
        const writeTime = new Date();
        this.storedAt = writeTime.toISOString();
        await cache.set('cache-example:datetime', writeTime.toISOString(), 60);

        // 2. Wait ~3 seconds. The "real" current time advances; the cached
        //    value must NOT (if the cache is working).
        const delayMs = 3000;
        const start = Date.now();
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        this.elapsedMs = Date.now() - start;

        // 3. Read the cached value back. On a cache hit this is the original
        //    timestamp from step 1 — it will NOT match the current time.
        const readTime = new Date();
        this.readAt = readTime.toISOString();
        const cached = await cache.get<string>('cache-example:datetime');
        this.cachedAt = cached ?? '(miss — cache returned undefined)';

        // 4. The cache works iff the cached value equals what we stored (and
        //    is older than the current time by ~the delay).
        this.cacheHit = cached === writeTime.toISOString();
    }

    private row(label: string, value: unknown): TemplateResult {
        return html`
            <tr>
                <td class="border border-gray-300 px-3 py-1.5 font-mono text-sm text-gray-600">${label}</td>
                <td class="border border-gray-300 px-3 py-1.5 font-mono text-sm">${String(value)}</td>
            </tr>
        `;
    }

    render(): TemplateResult {
        const ran = this.storedAt !== '';
        return component(Layout, { dir: 'ltr' }, html`
            <div>
                <h1 class="text-2xl font-bold mb-2">Cache Example</h1>
                <p class="mb-4 text-gray-600">
                    This demo caches the current datetime using the default in-memory store,
                    waits ~3 seconds, then reads it back. If the cache works, the read value
                    is the <em>original</em> timestamp — proving the value was stored and
                    retrieved, not recomputed.
                </p>

                <button
                    class="px-4 py-2 bg-blue-500 text-white rounded ${this.loading['runCacheTest'] ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'}"
                    @click=${this.runCacheTest}
                    ?disabled=${this.loading['runCacheTest']}
                >
                    ${this.loading['runCacheTest'] ? 'Running...' : 'Run cache test'}
                </button>

                ${ran
                    ? html`
                        <h2 class="text-lg font-semibold mt-6 mb-2">Result</h2>
                        <div class="mb-4 p-3 rounded-lg ${this.cacheHit
                            ? 'bg-green-50 text-green-800 border border-green-300'
                            : 'bg-red-50 text-red-800 border border-red-300'}">
                            <strong>${this.cacheHit ? '✓ Cache works' : '✗ Cache miss'}</strong>
                            — ${this.cacheHit
                                ? 'the cached value matched the original write; it was served from the cache.'
                                : 'the cached value did not match (or was missing).'}
                        </div>

                        <table class="border-collapse mb-4">
                            ${this.row('Written to cache at', this.storedAt)}
                            ${this.row('Read from cache at', this.cachedAt)}
                            ${this.row('Actual current time at read', this.readAt)}
                            ${this.row('Artificial delay', `${this.elapsedMs}ms`)}
                        </table>

                        <p class="text-sm text-gray-500">
                            Notice the "read from cache" time equals the "written" time (not the
                            current time) — the value was served from the cache rather than
                            recomputed. See <a href="/docs/cache.md" class="text-blue-500 underline">the cache docs</a>
                            for configuration and other backends (KV, Durable Object, database).
                        </p>
                    `
                    : html`<p class="mt-4 text-gray-400">Click "Run cache test" to begin.</p>`}
            </div>
        `);
    }
}
