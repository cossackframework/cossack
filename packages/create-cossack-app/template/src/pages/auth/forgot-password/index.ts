import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Field, Input, Button, Alert } from '@cossackframework/ui';
import { requestPasswordReset } from '../../../auth';

@Page({ transport: 'http' })
export default class ForgotPasswordPage extends Cossack {
    @State()
    @Validate({ rules: { required: true, email: true, message: 'Enter a valid email' }, config: { trigger: 'all', runOn: 'both' } })
    email = '';

    @State() submitted = false;

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        const ok = await this.validateAll();
        if (!ok) { this.requestUpdate(); return; }
        await this.requestReset(this.email);
        this.submitted = true;
        this.requestUpdate();
    }

    @Server()
    async requestReset(email: string) {
        // Build the reset base URL from the request origin.
        const origin = new URL(this.c.req.url).origin;
        await requestPasswordReset(email, origin);
    }

    render() {
        return html`
            <h3 class="mb-6 text-xl font-semibold text-foreground">${__('Forgot Password')}</h3>
            ${this.submitted
                ? component(Alert, { variant: 'success', title: __('Check your email') },
                    __('If an account exists for that email, a reset link has been sent.'))
                : html`<form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                    ${component(Field, { label: __('Email'), for: 'email', error: this.getError('email') },
                        component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('email') ? 'error' : 'default', '.value': this.email, '@input': (e: any) => this.setProperty('email', e.target.value) }))}
                    ${component(Button, { type: 'submit', block: true }, __('Send Reset Link'))}
                </form>`}
            <p class="mt-6 text-center text-sm text-muted-foreground">
                <a href="/auth/login" class="text-primary font-medium hover:underline">&larr; ${__('Back to Login')}</a>
            </p>
        `;
    }
}
