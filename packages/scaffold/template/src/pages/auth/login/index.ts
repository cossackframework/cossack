import { Cossack, Page, State, ClientStore, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { Field, Input, PasswordInput, Button, Alert } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { setCookie } from 'hono/cookie';
import { authSessions, beginTwoFactor, completePasskeySignIn, loginUser, passkeySignIn, registrationOpen, twoFactorAvailable, TWO_FACTOR_COOKIE } from '../../../auth';
import { loginInput, type LoginInput } from '../../../auth-input';
import { usePasskey } from '../../../passkeys.client';

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
    @State() canRegister = true;
    /** The auth store supports passkeys. */
    @State() passkeys = false;

    async init() {
        this.canRegister = await registrationOpen();
        this.passkeys = twoFactorAvailable;
    }

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
            // With an authenticator app, the password only starts the sign-in.
            const pending = await beginTwoFactor(user.id);
            if (pending) {
                setCookie(this.c, TWO_FACTOR_COOKIE, pending, { path: '/auth', httpOnly: true, sameSite: 'Lax', maxAge: 300, secure: new URL(this.c.req.url).protocol === 'https:' });
                this.redirect('/auth/two-factor');
                return;
            }
            const { headers } = await authSessions.create(user.id, this.c);
            headers.forEach((value, key) => this.c.header(key, value));
            this.redirect(config('auth.redirectAfterLogin'));
        } catch {
            this.error = 'Could not sign in. Try again.';
        }
    }

    /** Sign in with a passkey: no password and no code. */
    @Client()
    async signInWithPasskey() {
        this.error = '';
        try {
            const { challenge, options } = await this.passkeyOptions();
            const response = await usePasskey(options);
            await this.passkeyLogin(challenge, response);
        } catch (error) {
            if ((error as Error)?.name === 'NotAllowedError') return;
            this.error = (error as Error)?.message || 'The passkey sign-in did not work.';
        }
    }

    @Server()
    async passkeyOptions() {
        return passkeySignIn(this.c);
    }

    @Server()
    async passkeyLogin(challenge: string, response: unknown) {
        const user = await completePasskeySignIn(this.c, challenge, response as never);
        if (!user) { this.error = 'This passkey is not recognised.'; return; }
        const { headers } = await authSessions.create(user.id, this.c);
        headers.forEach((value, key) => this.c.header(key, value));
        this.redirect(config('auth.redirectAfterLogin'));
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
            ${this.passkeys ? html`<div class="mt-4 space-y-4">
                <p class="flex items-center gap-3 text-xs uppercase text-muted-foreground"><span class="h-px flex-1 bg-border"></span>${__('or')}<span class="h-px flex-1 bg-border"></span></p>
                ${component(Button, { type: 'button', variant: 'outline', block: true, '@click': () => this.signInWithPasskey() }, __('Sign in with a passkey'))}
            </div>` : null}
            <p class="mt-6 text-center text-sm text-muted-foreground" ?hidden=${!this.canRegister}>
                ${__("Don't have an account?")}
                <a href="/auth/register" class="text-primary font-medium hover:underline">${__('Register')}</a>
            </p>
        `;
    }
}
