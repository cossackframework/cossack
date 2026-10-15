import { Cossack, Page, State, ClientStore, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { Field, Input, PasswordInput, Button, Alert } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { authSessions, loginUser } from '../../../auth';
import { loginInput, type LoginInput } from '../../../auth-input';

interface LoginForm {
    email: string;
    password: string;
}

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
    @ClientStore()
    @Validate({
        rules: storeRules<LoginForm>({
            email: { required: true, email: true, message: 'Enter a valid email' },
            password: { required: true, minLength: 8, message: 'Password must be at least 8 characters' },
        }),
        config: { trigger: 'all', runOn: 'client' }
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
            await this.login({ email: this.form.email, password: this.form.password });
        } catch {
            this.error = 'Could not sign in. Check your details and try again.';
        }
    }

    @Server({ input: loginInput })
    async login(submitted: LoginInput) {
        // Native server calls bypass decorator gates, so validate here too.
        const { email, password } = await loginInput.parse(submitted);
        this.error = '';
        try {
            const user = await loginUser(email, password);
            if (!user) { this.error = 'Invalid credentials'; return; }
            const { headers } = await authSessions.create(user.id, this.c);
            headers.forEach((value, key) => this.c.header(key, value));
            this.redirect(config('auth.redirectAfterLogin'));
        } catch {
            this.error = 'Could not sign in. Try again.';
        }
    }

    render() {
        return html`
            <h3 class="mb-6 text-xl font-semibold text-foreground">${__('Login')}</h3>
            <form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                ${component(Field, { label: __('Email'), for: 'email', error: this.getError('form.email'),
                    control: attributes => component(Input, { ...attributes, type: 'email', placeholder: 'user@example.com', variant: this.hasError('form.email') ? 'error' : 'default', '.value': bind(this.form, 'email') }) })}
                ${component(Field, { label: __('Password'), for: 'password', error: this.getError('form.password'),
                    control: attributes => component(PasswordInput, { ...attributes, value: this.form.password, onValueChange: (v: string) => this.form.password = v }) })}
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
