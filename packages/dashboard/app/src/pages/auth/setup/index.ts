import { Client, Cossack, Page, Server, State, isClientVisibleError, type HeadValue } from '@cossackframework/core';
import { Alert, Button, Field, Input, PasswordInput } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { authSessions, completeSetup, setupRequired } from '#app/auth';
import { setupInput, type SetupInput } from '#app/auth-input';

/**
 * First run: create the first account, which administers the site. The page asks for
 * SETUP_CODE from the environment, so a visitor cannot claim a fresh deployment, and works
 * only while no account exists.
 */
@Page({ transport: 'http' })
export default class SetupPage extends Cossack {
    @State() done = false;
    @State() error = '';
    @State() form = { code: '', name: '', email: '', password: '' };

    head(): HeadValue {
        return { title: 'Set up your site' };
    }

    async init() {
        this.done = !(await setupRequired());
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.setup({ ...this.form });
    }

    @Server({ input: setupInput })
    async setup(submitted: SetupInput) {
        const { code, name, email, password } = await setupInput.parse(submitted);
        this.error = '';
        try {
            const user = await completeSetup(code, { email, password, name });
            const { headers } = await authSessions.create(user.id, this.c);
            headers.forEach((value, key) => this.c.header(key, value));
            this.redirect(config('auth.redirectAfterLogin'));
        } catch (error) {
            // Only messages written for the visitor reach the page.
            this.error = isClientVisibleError(error) ? error.message : 'The administrator could not be created.';
        }
    }

    render() {
        if (this.done) return html`
            <h3 class="mb-3 text-xl font-semibold text-foreground">${__('Set up your site')}</h3>
            ${component(Alert, {}, __('This site is already set up.'))}
            <p class="mt-6 text-center text-sm text-muted-foreground"><a href="/auth/login" class="text-primary font-medium hover:underline">${__('Sign in')}</a></p>
        `;
        return html`
            <h3 class="mb-2 text-xl font-semibold text-foreground">${__('Set up your site')}</h3>
            <p class="mb-6 text-sm text-muted-foreground">${__('Create the first account. It administers the site.')}</p>
            <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                ${component(Field, { label: __('Setup code'), for: 'setup-code', hint: __('The value of SETUP_CODE in the environment.'),
                    control: attributes => component(Input, { ...attributes, type: 'password', autocomplete: 'off', required: true, '.value': bind(this.form, 'code') }) })}
                ${component(Field, { label: __('Name'), for: 'setup-name',
                    control: attributes => component(Input, { ...attributes, type: 'text', autocomplete: 'name', '.value': bind(this.form, 'name') }) })}
                ${component(Field, { label: __('Email'), for: 'setup-email',
                    control: attributes => component(Input, { ...attributes, type: 'email', autocomplete: 'username', spellcheck: 'false', required: true, '.value': bind(this.form, 'email') }) })}
                ${component(Field, { label: __('Password'), for: 'setup-password',
                    control: attributes => component(PasswordInput, { ...attributes, autocomplete: 'new-password', required: true, minlength: 8, value: this.form.password, onValueChange: (value: string) => { this.form.password = value; } }) })}
                ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                ${component(Button, { type: 'submit', block: true }, __('Create administrator'))}
            </form>
        `;
    }
}
