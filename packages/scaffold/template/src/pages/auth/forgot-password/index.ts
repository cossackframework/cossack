import { Cossack, Page, State, ClientState, ClientStore, Validate, Client, Server, storeRules, ClientVisibleError, isClientVisibleError } from '@cossackframework/core';
import { Field, Input, Button, Alert, Turnstile } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { requestPasswordReset } from '../../../auth';
import { resetRequestInput, type ResetRequestInput } from '../../../auth-input';
import { botCheckKey, passesBotCheck } from '../../../auth-bot-check';
import { BOT_CHECK_FAILED, botCheckToken } from '../../../auth-bot-token';

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
    /** The Turnstile site key while the bot check is on. */
    @State() botKey: string | null = null;

    async init() {
        this.botKey = botCheckKey();
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) return;
        try {
            await this.requestReset({ email: this.form.email, turnstile: botCheckToken(event.target) });
            this.submitted = true;
        } catch (error) {
            this.error = isClientVisibleError(error) && error.message === BOT_CHECK_FAILED ? BOT_CHECK_FAILED : 'Could not send the reset link. Try again.';
        }
    }

    @Server({ input: resetRequestInput })
    async requestReset(submitted: ResetRequestInput) {
        const { email, turnstile } = await resetRequestInput.parse(submitted);
        // Before anything else, so a failed check says nothing about the account.
        if (!(await passesBotCheck(turnstile, 'reset'))) throw new ClientVisibleError(BOT_CHECK_FAILED);
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
            ${this.error ? html`<div class="mb-4">${component(Alert, { variant: 'destructive' }, this.error)}</div>` : null}
            ${this.submitted
                ? component(Alert, { variant: 'success', title: __('Check your email') },
                    __('If an account exists for that email, a reset link has been sent.'))
                : html`<form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                    ${component(Field, { label: __('Email'), for: 'email', error: this.getError('form.email'),
                        control: attributes => component(Input, { ...attributes, type: 'email', placeholder: 'user@example.com', variant: this.hasError('form.email') ? 'error' : 'default', '.value': bind(this.form, 'email') }) })}
                    ${this.botKey ? component(Turnstile, { id: 'reset-verify', siteKey: this.botKey, action: 'reset', label: __('Bot protection') }) : null}
                    ${component(Button, { type: 'submit', block: true }, __('Send Reset Link'))}
                </form>`}
            <p class="mt-6 text-center text-sm text-muted-foreground">
                <a href="/auth/login" class="text-primary font-medium hover:underline">&larr; ${__('Back to Login')}</a>
            </p>
        `;
    }
}
