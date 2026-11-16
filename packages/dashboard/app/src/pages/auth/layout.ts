import { Cossack, Page, server$ } from '@cossackframework/core';
import { Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { signInBrand } from '#app/brand';

@Page({ transport: 'http' })
export default class AuthLayout extends Cossack {
    brand = server$(() => signInBrand(), { initial: { name: 'Cossack', logo: '/logo.svg', logoOnly: false, home: '/', network: '', networkSignIn: null } });
    render() {
        return html`
            <div class="flex justify-center items-center min-h-screen bg-muted/40 px-4">
                ${component(Card, { class: 'w-full max-w-sm' }, html`
                    ${component(CardBody, { class: 'pt-6' }, html`
                        <a href=${this.brand.home} class="flex items-center justify-center gap-2 mb-6">
                            ${this.brand.logoOnly
                                ? html`<img src=${this.brand.logo} alt=${this.brand.name} width="48" height="48" class="h-12 w-auto max-w-56 object-contain" />`
                                : html`<img src=${this.brand.logo} alt="" width="32" height="32" class="h-8 w-auto max-w-32 object-contain" />
                            <span class="text-lg font-semibold text-foreground">${this.brand.name}</span>`}
                        </a>
                        ${this.brand.network ? html`<p class="-mt-4 mb-6 text-center text-sm text-muted-foreground">${__('Sign in with your account on')} ${this.brand.network}.</p>` : null}
                        ${this.children}
                        ${this.brand.networkSignIn ? html`<p class="mt-6 text-center text-sm text-muted-foreground">${__('Network account?')}
                            <a href=${this.brand.networkSignIn.href} data-network-sign-in class="font-medium text-primary hover:underline">${__('Sign in on')} ${this.brand.networkSignIn.name}</a></p>` : null}
                        <div class="mt-6 text-center text-sm">
                            <a href=${this.brand.home} class="text-muted-foreground hover:text-foreground">&larr; ${__('Back to Home')}</a>
                        </div>
                    `)}
                `)}
            </div>
        `;
    }
}
