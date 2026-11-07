import { Cossack, Page, State, ClientStore, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { Field, PasswordInput, Button, Alert } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { resetPassword } from '../../../auth';
import { resetPasswordInput, type ResetPasswordInput } from '../../../auth-input';

@Page({ transport: 'http' })
export default class ResetPasswordPage extends Cossack {
    @ClientStore()
    @Validate({
        rules: storeRules<{ password: string; confirm: string }>({
            password: { required: true, minLength: 8, message: 'Password must be at least 8 characters' },
            confirm: { required: true, customAsync: async (value: string, page?: ResetPasswordPage) => value === page?.form.password, message: 'The passwords do not match' },
        }),
        config: { trigger: 'all', runOn: 'client' }
    })
    form: { password: string; confirm: string } = { password: '', confirm: '' };

    @State() error = '';

    private get token(): string {
        return this.c?.req?.query('token') ?? '';
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) return;
        try {
            await this.doReset({ token: this.token, password: this.form.password, confirm: this.form.confirm });
        } catch {
            this.error = 'Could not reset the password. Check the link and try again.';
        }
    }

    @Server({ input: resetPasswordInput })
    async doReset(submitted: ResetPasswordInput) {
        const { token, password, confirm } = await resetPasswordInput.parse(submitted);
        this.error = '';
        if (confirm !== password) { this.error = 'The passwords do not match'; return; }
        try {
            const ok = await resetPassword(token, password);
            if (!ok) { this.error = 'Invalid or expired reset link'; return; }
            this.redirect('/auth/login');
        } catch {
            this.error = 'Could not reset the password. Request a new reset link.';
        }
    }

    render() {
        return html`
            <h3 class="mb-6 text-xl font-semibold text-foreground">${__('Reset Password')}</h3>
            <form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                ${component(Field, { label: __('New Password'), for: 'password', error: this.getError('form.password'),
                    control: attributes => component(PasswordInput, { ...attributes, value: this.form.password, placeholder: '••••••••', autocomplete: 'new-password', onValueChange: (v: string) => this.form.password = v }) })}
                ${component(Field, { label: __('Confirm New Password'), for: 'confirm', error: this.getError('form.confirm'),
                    control: attributes => component(PasswordInput, { ...attributes, value: this.form.confirm, placeholder: '••••••••', autocomplete: 'new-password', onValueChange: (v: string) => this.form.confirm = v }) })}
                ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                ${component(Button, { type: 'submit', block: true }, __('Reset Password'))}
            </form>
        `;
    }
}
