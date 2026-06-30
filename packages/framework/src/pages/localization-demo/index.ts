import { Cossack, Page, State, ClientState, Client, HeadContext, HeadValue, getLocale } from '@cossackframework/core';
import { html, TemplateResult } from '@cossackframework/renderer';

@Page({
    transport: 'http',
})
export class LocalizationDemo extends Cossack {
    @State()
    appleCount = 3;

    @ClientState()
    currentDisplayName = 'world';

    // Updated when the `localechange` event fires so the "current locale"
    // badge reflects runtime switches without a full reload.
    @ClientState()
    activeLocaleLabel = '';

    head(_context: HeadContext): HeadValue {
        return {
            title: 'Localization',
            description: 'Demo of `__()`, placeholders, pluralization, and runtime locale switching.',
        };
    }

    onMount() {
        this.activeLocaleLabel = getLocale();
        window.addEventListener('localechange', this.handleLocaleChange);
    }

    onUnmount() {
        window.removeEventListener('localechange', this.handleLocaleChange);
    }

    private handleLocaleChange = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.locale) this.activeLocaleLabel = detail.locale;
    };

    @Client()
    async switchLocale(locale: string) {
        await setLocale(locale);
    }

    @Client()
    async switchAutoBrowser() {
        await setLocale('AUTO:BROWSER');
    }

    render(): TemplateResult | null {
        return html`
            <div class="p-8 max-w-2xl">
                <h1 class="text-2xl font-bold mb-4">${__('welcome')}</h1>

                <p class="mb-4">
                    Current locale: <code class="bg-gray-100 px-2 py-1 rounded">${this.activeLocaleLabel}</code>
                    <span class="text-gray-500 text-sm ml-2">
                        (&lt;html lang="${getLocale()}">)
                    </span>
                </p>

                <div class="flex gap-2 mb-8">
                    <button
                        class="px-3 py-1 border rounded ${getLocale() === 'en' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'}"
                        @click=${() => this.switchLocale('en')}
                    >English</button>
                    <button
                        class="px-3 py-1 border rounded ${getLocale() === 'es' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'}"
                        @click=${() => this.switchLocale('es')}
                    >Español</button>
                    <button
                        class="px-3 py-1 border rounded ${getLocale() === 'ru' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'}"
                        @click=${() => this.switchLocale('ru')}
                    >Русский</button>
                    <button
                        class="px-3 py-1 border rounded bg-gray-100"
                        @click=${this.switchAutoBrowser}
                        title="Follow navigator.languages"
                    >AUTO:BROWSER</button>
                </div>

                <section class="mb-6">
                    <h2 class="text-lg font-semibold mb-2">Placeholders</h2>
                    <ul class="space-y-1 text-sm">
                        <li><code>:name</code> → ${__('greeting', { name: this.currentDisplayName })}</li>
                        <li><code>:NAME</code> → ${__('greetingUpper', { name: this.currentDisplayName })}</li>
                        <li><code>:Name</code> → ${__('greetingTitle', { name: this.currentDisplayName })}</li>
                    </ul>
                </section>

                <section class="mb-6">
                    <h2 class="text-lg font-semibold mb-2">Pluralization</h2>
                    <p class="mb-2">${__('apples', { count: this.appleCount })}</p>
                    <div class="flex gap-2 items-center">
                        <button class="px-3 py-1 border rounded" @click=${() => this.appleCount = Math.max(0, this.appleCount - 1)}>-</button>
                        <span class="w-12 text-center">${this.appleCount}</span>
                        <button class="px-3 py-1 border rounded" @click=${() => this.appleCount = this.appleCount + 1}>+</button>
                    </div>
                    <p class="text-xs text-gray-500 mt-2">
                        Russian uses 3 plural forms; English/Spanish use 2. Try switching with count = 1, 2, 5.
                    </p>
                </section>

                <section class="mb-6">
                    <h2 class="text-lg font-semibold mb-2">Translation strings as keys</h2>
                    <p>${__('I love programming.')}</p>
                </section>

                <section class="mb-6">
                    <h2 class="text-lg font-semibold mb-2">Missing keys</h2>
                    <p>${__('this.key.does.not.exist')}</p>
                    <p class="text-xs text-gray-500 mt-1">Falls back to the key itself (the default-language text).</p>
                </section>
            </div>
        `;
    }
}
