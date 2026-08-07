import { Cossack, Page, State, ClientState, Client, HeadContext, HeadValue, OnWindow, getLocale } from '@cossackframework/core';
import { component, html, TemplateResult } from '@cossackframework/renderer';
import { Badge, Button, ButtonGroup, Typography } from '@cossackframework/ui';

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
    }

    @OnWindow('localechange')
    private handleLocaleChange(event: CustomEvent<{ locale?: string }>) {
        if (event.detail?.locale) this.activeLocaleLabel = event.detail.locale;
    }

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
                ${component(Typography, { variant: 'h1' }, __('welcome'))}

                <p class="mb-4">
                    Current locale: ${component(Badge, { variant: 'secondary' }, this.activeLocaleLabel)}
                    <span class="text-gray-500 text-sm ml-2">
                        (&lt;html lang="${getLocale()}">)
                    </span>
                </p>

                <div class="mb-8">${component(ButtonGroup, {}, html`
                    ${component(Button, { variant: getLocale() === 'en' ? 'default' : 'outline', '@click': () => this.switchLocale('en') }, 'English')}
                    ${component(Button, { variant: getLocale() === 'es' ? 'default' : 'outline', '@click': () => this.switchLocale('es') }, 'Español')}
                    ${component(Button, { variant: getLocale() === 'ru' ? 'default' : 'outline', '@click': () => this.switchLocale('ru') }, 'Русский')}
                    ${component(Button, { variant: 'secondary', '@click': this.switchAutoBrowser, title: 'Follow navigator.languages' }, 'AUTO:BROWSER')}
                `)}</div>

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
                        ${component(Button, { variant: 'outline', size: 'icon', '@click': () => this.appleCount = Math.max(0, this.appleCount - 1) }, '−')}
                        <span class="w-12 text-center">${this.appleCount}</span>
                        ${component(Button, { size: 'icon', '@click': () => this.appleCount = this.appleCount + 1 }, '+')}
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
