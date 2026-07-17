import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Field, PasswordInput, Button, Alert } from '@cossackframework/ui';
import { resetPassword } from '../../../auth';

@Page({ transport: 'http' })
export default class ResetPasswordPage extends Cossack {
    @State()
    @Validate({ rules: { required: true, minLength: 8, message: 'Password must be at least 8 characters' }, config: { trigger: 'all', runOn: 'both' } })
    password = '';

    @State() error = '';

    private get token(): string {
        return this.c?.req?.query('token') ?? '';
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) { this.requestUpdate(); return; }
        try {
            await this.doReset(this.token, this.password);
        } catch (e: any) {
            this.error = e?.message || 'Reset failed';
            this.requestUpdate();
        }
    }

    @Server()
    async doReset(token: string, password: string) {
        const ok = await resetPassword(token, password);
        if (!ok) { this.error = 'Invalid or expired reset link'; this.requestUpdate(); return; }
        this.redirect('/auth/login');
    }

    render() {
        return html`
            <h3 class="mb-6 text-xl font-semibold text-foreground">${__('Reset Password')}</h3>
            <form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                ${component(Field, { label: __('New Password'), for: 'password', error: this.getError('password') },
                    component(PasswordInput, { value: this.password, placeholder: '••••••••', onChange: (v: string) => this.setProperty('password', v) }))}
                ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                ${component(Button, { type: 'submit', block: true }, __('Reset Password'))}
            </form>
        `;
    }
}
