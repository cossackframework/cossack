import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Field, Input, PasswordInput, Button, Alert } from '@cossackframework/ui';
import { auth, registerUser } from '../../../auth';

@Page({ transport: 'http' })
export default class RegisterPage extends Cossack {
    @State()
    name = '';

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
            await this.register(this.name, this.email, this.password);
        } catch (e: any) {
            this.error = e?.message || 'Registration failed';
            this.requestUpdate();
        }
    }

    @Server()
    async register(name: string, email: string, password: string) {
        const user = await registerUser(email, password, name || undefined);
        if (auth.createSession) {
            const { headers } = await auth.createSession(user as any, this.c);
            headers.forEach((value, key) => this.c.header(key, value));
        }
        this.redirect(config('auth.redirectAfterLogin'));
    }

    render() {
        return html`
            <h3 class="mb-6 text-xl font-semibold text-foreground">${__('Register')}</h3>
            <form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                ${component(Field, { label: __('Name'), for: 'name' },
                    component(Input, { id: 'name', type: 'text', '.value': this.name, '@input': (e: any) => this.setProperty('name', e.target.value) }))}
                ${component(Field, { label: __('Email'), for: 'email', error: this.getError('email') },
                    component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('email') ? 'error' : 'default', '.value': this.email, '@input': (e: any) => this.setProperty('email', e.target.value) }))}
                ${component(Field, { label: __('Password'), for: 'password', error: this.getError('password') },
                    component(PasswordInput, { value: this.password, onChange: (v: string) => this.setProperty('password', v) }))}
                ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                ${component(Button, { type: 'submit', block: true }, __('Create Account'))}
            </form>
            <p class="mt-6 text-center text-sm text-muted-foreground">
                ${__('Already have an account?')}
                <a href="/auth/login" class="text-primary font-medium hover:underline">${__('Login')}</a>
            </p>
        `;
    }
}
