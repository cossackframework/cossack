import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Field, Input, PasswordInput, Button, Alert } from '@cossackframework/ui';
import { guard } from '../../../../services/rbac';
import { createUser } from '../../../../services/users';

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class NewUserPage extends Cossack {
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
            await this.create(this.name, this.email, this.password);
        } catch (e: any) {
            this.error = e?.message || __('Could not create user');
            this.requestUpdate();
        }
    }

    @Server()
    async create(name: string, email: string, password: string) {
        await createUser({ email, password, name: name || undefined });
        this.redirect('/dashboard/users');
    }

    render() {
        return html`
            <div class="space-y-8 max-w-2xl">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('New user')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Create a new user account.')}</p>
                </div>

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Details')}</h2>`)}
                    ${component(CardBody, {}, html`
                        <form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                            ${component(Field, { label: __('Name'), for: 'name' },
                                component(Input, { id: 'name', type: 'text', '.value': this.name, '@input': (e: any) => this.setProperty('name', e.target.value) }))}
                            ${component(Field, { label: __('Email'), for: 'email', error: this.getError('email') },
                                component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('email') ? 'error' : 'default', '.value': this.email, '@input': (e: any) => this.setProperty('email', e.target.value) }))}
                            ${component(Field, { label: __('Password'), for: 'password', error: this.getError('password') },
                                component(PasswordInput, { value: this.password, onChange: (v: string) => this.setProperty('password', v) }))}
                            ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                            <div class="flex items-center gap-2">
                                ${component(Button, { type: 'submit' }, __('Create user'))}
                                <a href="/dashboard/users"
                                   class="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                                    ${__('Cancel')}
                                </a>
                            </div>
                        </form>
                    `)}
                `)}
            </div>
        `;
    }
}
