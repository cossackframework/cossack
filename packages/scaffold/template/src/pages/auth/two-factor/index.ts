import { Cossack, Page, State, Server, Client } from '@cossackframework/core';
import { Alert, Button, Field, Input } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { deleteCookie, getCookie } from 'hono/cookie';
import { authSessions, completeTwoFactor, TWO_FACTOR_COOKIE } from '../../../auth';

/**
 * The second step of signing in: a code from the authenticator app, or a recovery code. The
 * password step left a pending sign-in in a cookie; it lasts five minutes and five tries.
 */
@Page({ transport: 'http' })
export default class TwoFactorPage extends Cossack {
    @State() code = '';
    @State() error = '';
    @State() recovery = false;

    async init() {
        if (!getCookie(this.c, TWO_FACTOR_COOKIE)) this.error = __('Enter your email and password first.');
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.verify(this.code);
    }

    @Server()
    async verify(code: string) {
        this.error = '';
        const pending = getCookie(this.c, TWO_FACTOR_COOKIE) ?? '';
        const result = await completeTwoFactor(pending, code);
        if ('error' in result) {
            this.error = result.error;
            if (result.expired) deleteCookie(this.c, TWO_FACTOR_COOKIE, { path: '/auth' });
            this.code = '';
            return;
        }
        deleteCookie(this.c, TWO_FACTOR_COOKIE, { path: '/auth' });
        const { headers } = await authSessions.create(result.user.id, this.c);
        headers.forEach((value, key) => this.c.header(key, value));
        // A used recovery code is a hint to set up the app again.
        this.redirect(result.recovery ? '/dashboard/profile/security?recovered=1' : config('auth.redirectAfterLogin'));
    }

    render() {
        return html`
            <h3 class="mb-2 text-xl font-semibold text-foreground">${__('Two-step sign-in')}</h3>
            <p class="mb-6 text-sm text-muted-foreground">${this.recovery ? __('Enter one of your recovery codes. Each works once.') : __('Enter the 6-digit code from your authenticator app.')}</p>
            <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                ${component(Field, { label: this.recovery ? __('Recovery code') : __('Code'), for: 'two-factor-code',
                    control: attributes => component(Input, { ...attributes, autocomplete: 'one-time-code', inputmode: this.recovery ? 'text' : 'numeric', required: true, autofocus: true,
                        maxlength: this.recovery ? 20 : 6, '.value': this.code, '@input': (event: Event) => { this.code = (event.target as HTMLInputElement).value; } }) })}
                ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                ${component(Button, { type: 'submit', block: true, disabled: !this.code.trim() }, __('Verify'))}
            </form>
            <div class="mt-6 flex justify-between text-sm">
                <button type="button" class="text-primary hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => { this.recovery = !this.recovery; this.code = ''; }}>
                    ${this.recovery ? __('Use the authenticator app') : __('Use a recovery code')}</button>
                <a href="/auth/login" class="text-muted-foreground hover:text-foreground">${__('Start over')}</a>
            </div>
        `;
    }
}
