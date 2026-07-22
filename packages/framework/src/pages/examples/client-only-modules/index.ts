import { Client, ClientState, Cossack, Page, connectStore } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';
import {
    describeBrowser,
    saveTheme,
    themeStore,
    type Theme,
} from '../../../examples/client-only-modules/preferences.client';

@Page({ transport: 'http' })
export default class ClientOnlyModulesExample extends Cossack {
    @ClientState()
    theme: Theme = 'dark';

    @ClientState()
    browser = 'Waiting for the client to mount…';

    private disconnectTheme?: () => void;

    onMount() {
        // Client-only exports are first accessed after hydration. Importing
        // them above is safe during SSR because the module is replaced by lazy
        // placeholders on the server.
        this.disconnectTheme = connectStore(themeStore, this, 'theme');
        this.browser = describeBrowser();
    }

    onCleanup() {
        this.disconnectTheme?.();
    }

    @Client()
    toggleTheme() {
        const next: Theme = themeStore.get() === 'dark' ? 'light' : 'dark';
        themeStore.set(next);
        saveTheme(next);
    }

    render(): TemplateResult {
        return html`
            <main class="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
                <section class="w-full space-y-6 rounded-2xl border p-8 shadow-sm">
                    <div class="space-y-2">
                        <p class="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                            Client-only module example
                        </p>
                        <h1 class="text-3xl font-bold">Browser initialization without SSR crashes</h1>
                        <p class="text-muted-foreground">
                            <code>preferences.client.ts</code> reads localStorage at module scope.
                            SSR imports a generated placeholder, while the browser loads the real module.
                        </p>
                    </div>

                    <dl class="grid gap-4 rounded-xl bg-muted p-4">
                        <div>
                            <dt class="text-sm text-muted-foreground">Reactive theme</dt>
                            <dd class="font-semibold" data-testid="client-only-theme">${this.theme}</dd>
                        </div>
                        <div>
                            <dt class="text-sm text-muted-foreground">Browser details</dt>
                            <dd class="break-words font-mono text-sm" data-testid="client-only-browser">
                                ${this.browser}
                            </dd>
                        </div>
                    </dl>

                    <button
                        class="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
                        type="button"
                        @click="${this.toggleTheme}"
                    >
                        Toggle client-only store
                    </button>

                    <p class="text-sm text-muted-foreground">
                        Keep client-only exports out of <code>render()</code>, <code>init()</code>,
                        and server-side field initializers. Access them from <code>onMount()</code>,
                        <code>clientInit()</code>, or an <code>@Client()</code> method.
                    </p>
                </section>
            </main>
        `;
    }
}
