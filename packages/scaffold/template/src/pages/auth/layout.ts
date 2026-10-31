import { Cossack, Page, server$ } from '@cossackframework/core';
import { Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { siteLogo, siteName } from '../../brand';

@Page({ transport: 'http' })
export default class AuthLayout extends Cossack {
    appName = server$(() => siteName(), { initial: 'My App' });
    appLogo = server$(() => siteLogo(), { initial: '/logo.svg' });
    render() {
        return html`
            <div class="flex justify-center items-center min-h-screen bg-muted/40 px-4">
                ${component(Card, { class: 'w-full max-w-sm' }, html`
                    ${component(CardBody, { class: 'pt-6' }, html`
                        <a href="/" class="flex items-center justify-center gap-2 mb-6">
                            <img src=${this.appLogo} alt="" width="32" height="32" class="h-8 w-auto max-w-32 object-contain" />
                            <span class="text-lg font-semibold text-foreground">${this.appName}</span>
                        </a>
                        ${this.children}
                        <div class="mt-6 text-center text-sm">
                            <a href="/" class="text-muted-foreground hover:text-foreground">&larr; ${__('Back to Home')}</a>
                        </div>
                    `)}
                `)}
            </div>
        `;
    }
}
