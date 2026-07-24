import { Cossack, Page, State, Server, HeadContext, HeadValue } from '@cossackframework/core';
import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { config, env } from '@/config';

// Demonstrates the config() / env() helpers backed by src/config/app.ts.
// Values are read server-side in init() and stored in @State so they survive
// into the client render — config() / env() are server-only (they read
// request-scoped bindings via AsyncLocalStorage).
@Page({
    transport: 'http',
})
export default class ConfigDemo extends Cossack {
    @State()
    private appName: string = '';

    @State()
    private appEnv: string = '';

    @State()
    private appUrl: string = '';

    @State()
    private appDebug: boolean = false;

    @State()
    private timezone: string = '';

    @State()
    private locale: string = '';

    @State()
    private fallbackLocale: string = '';

    @State()
    private hasSecret: boolean = false;

    // A raw binding read (not from a config file) to show env() directly.
    @State()
    private rawBinding: string = '';

    head(_context: HeadContext): HeadValue {
        return {
            title: 'Config Demo',
            description: 'Demonstrates config() and env() helpers for reading per-request configuration values.',
        };
    }

    @Server()
    async init() {
        // config('file.key') reads from the evaluated config tree.
        // Types are inferred from the AppConfig interface in src/config/app.ts.
        this.appName = config('app.name');
        this.appEnv = config('app.env', 'production');
        this.appUrl = config('app.url');
        this.appDebug = config('app.debug', false);
        this.timezone = config('app.timezone', 'UTC');
        this.locale = config('app.locale', 'en');
        this.fallbackLocale = config('app.fallback_locale', 'en');

        // env('KEY') reads a flat binding directly from c.env.
        const secret = env('APP_SECRET');
        this.hasSecret = secret.length >= 16;
        this.rawBinding = env('SOME_BINDING', '(not set)');
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
        return html`
            <div>
                <h1 class="text-2xl font-bold mb-2">Configuration Demo</h1>
                <p class="mb-4 text-gray-600">
                    Values below are read from <code>src/config/app.ts</code> via <code>config()</code>
                    and from <code>c.env</code> via <code>env()</code>. They resolve per-request on the
                    server using AsyncLocalStorage.
                </p>

                <h2 class="text-lg font-semibold mt-6 mb-2">config() — config tree</h2>
                <table class="border-collapse">
                    ${this.row("config('app.name')", this.appName)}
                    ${this.row("config('app.env')", this.appEnv)}
                    ${this.row("config('app.url')", this.appUrl)}
                    ${this.row("config('app.debug')", this.appDebug)}
                    ${this.row("config('app.timezone')", this.timezone)}
                    ${this.row("config('app.locale')", this.locale)}
                    ${this.row("config('app.fallback_locale')", this.fallbackLocale)}
                </table>

                <h2 class="text-lg font-semibold mt-6 mb-2">env() — raw bindings</h2>
                <table class="border-collapse">
                    ${this.row("env('APP_SECRET')", this.hasSecret ? '✓ set (min 16 chars)' : '✗ not set or too short')}
                    ${this.row("env('SOME_BINDING', '(not set)')", this.rawBinding)}
                </table>

                <p class="mt-6 text-sm text-gray-500">
                    Config files are server-only — they never ship to the client bundle.
                    See <a href="/docs/config.md" class="text-blue-500 underline">the config docs</a> for details.
                </p>
            </div>
        `;
    }
}
