import { Cossack, Page, State, Store, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { html, component, bind } from '@cossackframework/renderer';
import { Field, Input, PasswordInput, Button, Alert } from '@cossackframework/ui';
import { auth, registerUser } from '../../../auth';

interface RegisterForm {
    name: string;
    email: string;
    password: string;
}

@Page({ transport: 'http' })
export default class RegisterPage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<RegisterForm>({
            email: { required: true, email: true, message: 'Enter a valid email' },
            password: { required: true, minLength: 8, message: 'Password must be at least 8 characters' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    form: RegisterForm = { name: '', email: '', password: '' };

    @State() error = '';

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) return;
        try {
            await this.register(this.form.name, this.form.email, this.form.password);
        } catch (e: any) {
            this.error = e?.message || 'Registration failed';
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
                    component(Input, { id: 'name', type: 'text', '.value': bind(this.form, 'name') }))}
                ${component(Field, { label: __('Email'), for: 'email', error: this.getError('form.email') },
                    component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('form.email') ? 'error' : 'default', '.value': bind(this.form, 'email') }))}
                ${component(Field, { label: __('Password'), for: 'password', error: this.getError('form.password') },
                    component(PasswordInput, { value: this.form.password, onChange: (v: string) => this.form.password = v }))}
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
