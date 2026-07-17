import { Cossack, Page, Store, State, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { html, component, bind } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Field, Input, PasswordInput, Button, Alert, Form } from '@cossackframework/ui';
import { guard } from '../../../../services/rbac';
import { createUser } from '../../../../services/users';

interface NewUserForm {
    name: string;
    email: string;
    password: string;
}

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class NewUserPage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<NewUserForm>({
            email: { required: true, email: true, message: 'Enter a valid email' },
            password: { required: true, minLength: 8, message: 'Password must be at least 8 characters' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    form: NewUserForm = { name: '', email: '', password: '' };

    @State() error = '';

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) return;
        try {
            await this.create(this.form.name, this.form.email, this.form.password);
        } catch (e: any) {
            this.error = e?.message || __('Could not create user');
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
                        ${component(Form, {
                            submit: (e: Event) => this.handleSubmit(e),
                        }, html`
                            ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                            <div class="flex flex-col space-y-4">
                            ${component(Field, { label: __('Name'), for: 'name' },
                                component(Input, { id: 'name', type: 'text', '.value': bind(this.form, 'name') }))}
                            ${component(Field, { label: __('Email'), for: 'email', error: this.getError('form.email') },
                                component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('form.email') ? 'error' : 'default', '.value': bind(this.form, 'email') }))}
                            ${component(Field, { label: __('Password'), for: 'password', error: this.getError('form.password') },
                                component(PasswordInput, { value: this.form.password, onChange: (v: string) => this.form.password = v }))}
                            <div class="flex items-center gap-2">
                                ${component(Button, { type: 'submit' }, __('Create user'))}
                                <a href="/dashboard/users"
                                   class="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                                    ${__('Cancel')}
                                </a>
                            </div>
                            </div>
                        `)}
                    `)}
                `)}
            </div>
        `;
    }
}
