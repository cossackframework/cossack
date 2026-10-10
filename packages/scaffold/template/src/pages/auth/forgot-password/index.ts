import { Cossack, Page, ClientState, ClientStore, Validate, Client, Server, storeRules, ClientVisibleError } from '@cossackframework/core';
import { Field, Input, Button, Alert } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { requestPasswordReset } from '../../../auth';
import { resetRequestInput, type ResetRequestInput } from '../../../auth-input';

@Page({ transport: 'http' })
export default class ForgotPasswordPage extends Cossack {
    @ClientStore()
    @Validate({
        rules: storeRules<{ email: string }>({
            email: { required: true, email: true, message: 'Enter a valid email' },
        }),
        config: { trigger: 'all', runOn: 'client' }
    })
    form: { email: string } = { email: '' };

    @ClientState() submitted = false;
    @ClientState() error = '';

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) return;
        try {
            await this.requestReset({ email: this.form.email });
            this.submitted = true;
        } catch {
            this.error = 'Could not send the reset link. Try again.';
        }
    }

    @Server({ input: resetRequestInput })
    async requestReset(submitted: ResetRequestInput) {
        const { email } = await resetRequestInput.parse(submitted);
        // Build the reset base URL from the request origin.
        const origin = new URL(this.c.req.url).origin;
        try {
            await requestPasswordReset(email, origin);
        } catch {
            throw new ClientVisibleError('Could not send the reset link. Try again.');
        }
    }

    render() {
        return html`
            <h3 class="mb-6 text-xl font-semibold text-foreground">${__('Forgot Password')}</h3>
            ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
            ${this.submitted
                ? component(Alert, { variant: 'success', title: __('Check your email') },
                    __('If an account exists for that email, a reset link has been sent.'))
                : html`<form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                    ${component(Field, { label: __('Email'), for: 'email', error: this.getError('form.email'),
                        control: attributes => component(Input, { ...attributes, type: 'email', placeholder: 'user@example.com', variant: this.hasError('form.email') ? 'error' : 'default', '.value': bind(this.form, 'email') }) })}
                    ${component(Button, { type: 'submit', block: true }, __('Send Reset Link'))}
                </form>`}
            <p class="mt-6 text-center text-sm text-muted-foreground">
                <a href="/auth/login" class="text-primary font-medium hover:underline">&larr; ${__('Back to Login')}</a>
            </p>
        `;
    }
}
