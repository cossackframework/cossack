import { html, component } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client } from '@cossackframework/core';
import {
    Button,
    Input,
    PasswordInput,
    Label,
    Separator,
} from '@cossackframework/ui';

export interface AuthFormProps {
    /** "login" or "signup" mode. */
    mode?: 'login' | 'signup';
    /** Called with form data on submit. Return false to keep loading state. */
    onSubmit?: (data: { email: string; password: string; name?: string }) => void | Promise<void>;
    /** Show social login buttons. Default true. */
    social?: boolean;
    [key: string]: any;
}

/**
 * Auth Form Block — login + signup form with validation.
 *
 * A complete authentication form wired with:
 *   - Email + password fields with inline validation
 *   - Password reveal toggle (eye icon)
 *   - Optional name field for signup mode
 *   - Social login buttons (Google / GitHub)
 *   - Loading + error states
 *   - Mode toggle between login ↔ signup
 *
 *   ${component(AuthForm, {
 *       mode: 'login',
 *       onSubmit: async (data) => { await login(data); },
 *   })}
 */
@Component()
export class AuthForm extends Cossack {
    declare props: AuthFormProps;

    @ClientState() mode: 'login' | 'signup' = 'login';
    @ClientState() email = '';
    @ClientState() password = '';
    @ClientState() name = '';
    @ClientState() submitting = false;
    @ClientState() error = '';
    @ClientState() emailError = '';
    @ClientState() passwordError = '';

    onMount() {
        this.mode = this.props.mode || 'login';
    }

    render() {
        const isSignup = this.mode === 'signup';
        const { social = true } = this.props;

        return html`
            <div class="cs-auth-form w-full max-w-sm mx-auto">
                <div class="text-center mb-6">
                    <h1 class="text-2xl font-bold text-foreground">
                        ${isSignup ? 'Create your account' : 'Welcome back'}
                    </h1>
                    <p class="text-sm text-muted-foreground mt-1">
                        ${isSignup ? 'Start your free trial today.' : 'Sign in to continue to your dashboard.'}
                    </p>
                </div>

                ${social ? html`
                    <div class="flex flex-col gap-2 mb-4">
                        <button type="button" class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-border bg-background text-sm font-medium text-foreground hover:bg-muted cursor-pointer transition-colors"
                            @click=${() => this.handleSocial('Google')}>
                            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                            Continue with Google
                        </button>
                        <button type="button" class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-border bg-background text-sm font-medium text-foreground hover:bg-muted cursor-pointer transition-colors"
                            @click=${() => this.handleSocial('GitHub')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48C19.14 20.16 22 16.42 22 12c0-5.52-4.48-10-10-10z"/></svg>
                            Continue with GitHub
                        </button>
                    </div>
                    <div class="flex items-center gap-3 mb-4">
                        <div class="flex-1 h-px bg-border"></div>
                        <span class="text-xs text-muted-foreground">OR</span>
                        <div class="flex-1 h-px bg-border"></div>
                    </div>
                ` : null}

                <form @submit=${(e: Event) => this.handleSubmit(e)} class="space-y-4">
                    ${isSignup ? html`
                        <div>
                            ${component(Label, { for: 'auth-name' }, 'Name')}
                            ${component(Input, {
                                id: 'auth-name',
                                type: 'text',
                                placeholder: 'Jane Doe',
                                '@input': (e: InputEvent) => { this.name = (e.target as HTMLInputElement).value; },
                            })}
                        </div>
                    ` : null}
                    <div>
                        ${component(Label, { for: 'auth-email' }, 'Email')}
                        ${component(Input, {
                            id: 'auth-email',
                            type: 'email',
                            placeholder: 'jane@example.com',
                            variant: this.emailError ? 'error' : 'default',
                            '@input': (e: InputEvent) => { this.email = (e.target as HTMLInputElement).value; this.emailError = ''; },
                        })}
                        ${this.emailError ? html`<p class="text-xs text-destructive mt-1">${this.emailError}</p>` : null}
                    </div>
                    <div>
                        ${component(Label, { for: 'auth-password' }, 'Password')}
                        ${component(PasswordInput, {
                            value: this.password,
                            placeholder: '••••••••',
                            onChange: (v: string) => { this.password = v; this.passwordError = ''; },
                        })}
                        ${this.passwordError ? html`<p class="text-xs text-destructive mt-1">${this.passwordError}</p>` : null}
                    </div>

                    ${this.error ? html`<div class="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">${this.error}</div>` : null}

                    ${component(Button, {
                        type: 'submit',
                        variant: 'primary',
                        block: true,
                        size: 'lg',
                        disabled: this.submitting,
                    }, this.submitting ? 'Please wait...' : (isSignup ? 'Create account' : 'Sign in'))}
                </form>

                <p class="text-center text-sm text-muted-foreground mt-6">
                    ${isSignup ? 'Already have an account? ' : "Don't have an account? "}
                    <button type="button" class="text-primary font-medium hover:underline cursor-pointer border-none bg-transparent p-0"
                        @click=${() => { this.mode = isSignup ? 'login' : 'signup'; this.error = ''; }}>
                        ${isSignup ? 'Sign in' : 'Sign up'}
                    </button>
                </p>
            </div>
        `;
    }

    @Client()
    private async handleSubmit(e: Event) {
        e.preventDefault();
        this.error = '';
        this.emailError = '';
        this.passwordError = '';

        // Validate.
        if (!this.email) { this.emailError = 'Email is required'; return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) { this.emailError = 'Invalid email address'; return; }
        if (!this.password) { this.passwordError = 'Password is required'; return; }
        if (this.password.length < 8) { this.passwordError = 'Password must be at least 8 characters'; return; }

        this.submitting = true;
        try {
            await this.props.onSubmit?.({
                email: this.email,
                password: this.password,
                name: this.mode === 'signup' ? this.name : undefined,
            });
        } catch (err: any) {
            this.error = err?.message || 'Something went wrong.';
        } finally {
            this.submitting = false;
        }
    }

    @Client()
    private handleSocial(provider: string) {
        // In a real app, redirect to OAuth. Here we just show the intent.
        this.props.onSubmit?.({ email: '', password: '' });
    }
}
