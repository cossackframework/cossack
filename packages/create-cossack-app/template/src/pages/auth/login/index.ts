import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Field, Input, PasswordInput, Button, Alert } from '@cossackframework/ui';
import { auth, loginUser } from '../../../auth';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
    @State()
    @Validate({ rules: { required: true, email: true, message: 'Enter a valid email' }, config: { trigger: 'all', runOn: 'both' } })
    email = '';

    @State()
    @Validate({ rules: { required: true, minLength: 8, message: 'Password must be at least 8 characters' }, config: { trigger: 'all', runOn: 'both' } })
    password = '';

    @State() error = '';

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) { this.requestUpdate(); return; }
        try {
            await this.login(this.email, this.password);
        } catch (e: any) {
            this.error = e?.message || 'Login failed';
            this.requestUpdate();
        }
    }

    @Server()
    async login(email: string, password: string) {
        const user = await loginUser(email, password);
        if (!user) { this.error = 'Invalid credentials'; this.requestUpdate(); return; }
        if (auth.createSession) {
            const { headers } = await auth.createSession(user as any, this.c);
            headers.forEach((value, key) => this.c.header(key, value));
        }
        this.redirect(config('auth.redirectAfterLogin'));
    }

    render() {
        return html`
            <h3 class="mb-6 text-xl font-semibold text-foreground">${__('Login')}</h3>
            <form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                ${component(Field, { label: __('Email'), for: 'email', error: this.getError('email') },
                    component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('email') ? 'error' : 'default', '.value': this.email, '@input': (e: any) => this.setProperty('email', e.target.value) }))}
                ${component(Field, { label: __('Password'), for: 'password', error: this.getError('password') },
                    component(PasswordInput, { value: this.password, onChange: (v: string) => this.setProperty('password', v) }))}
                <div class="text-right">
                    <a href="/auth/forgot-password" class="text-sm text-primary hover:underline">${__('Forgot password?')}</a>
                </div>
                ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                ${component(Button, { type: 'submit', block: true }, __('Sign In'))}
            </form>
            <p class="mt-6 text-center text-sm text-muted-foreground">
                ${__("Don't have an account?")}
                <a href="/auth/register" class="text-primary font-medium hover:underline">${__('Register')}</a>
            </p>
        `;
    }
}
