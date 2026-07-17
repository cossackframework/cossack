import { Cossack, Page, State, Store, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { html, component, bind } from '@cossackframework/renderer';
import { Field, Input, PasswordInput, Button, Alert } from '@cossackframework/ui';
import { auth, loginUser } from '../../../auth';

interface LoginForm {
    email: string;
    password: string;
}

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<LoginForm>({
            email: { required: true, email: true, message: 'Enter a valid email' },
            password: { required: true, minLength: 8, message: 'Password must be at least 8 characters' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    form: LoginForm = { email: '', password: '' };

    @State() error = '';

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) return;
        try {
            await this.login(this.form.email, this.form.password);
        } catch (e: any) {
            this.error = e?.message || 'Login failed';
        }
    }

    @Server()
    async login(email: string, password: string) {
        const user = await loginUser(email, password);
        if (!user) { this.error = 'Invalid credentials'; return; }
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
                ${component(Field, { label: __('Email'), for: 'email', error: this.getError('form.email') },
                    component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('form.email') ? 'error' : 'default', '.value': bind(this.form, 'email') }))}
                ${component(Field, { label: __('Password'), for: 'password', error: this.getError('form.password') },
                    component(PasswordInput, { value: this.form.password, onChange: (v: string) => this.form.password = v }))}
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
