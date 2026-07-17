import { Cossack, Page, Store, State, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { html, component, bind } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Field, Input, Button, Alert, Checkbox, Form } from '@cossackframework/ui';
import { guard } from '../../../../services/rbac';
import { createRole } from '../../../../services/roles';
import { PERMISSIONS, type Permission } from '../../../../lib/permissions';

interface NewRoleForm {
    name: string;
    permissions: Permission[];
}

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class NewRolePage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<NewRoleForm>({
            name: { required: true, message: 'Name is required' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    form: NewRoleForm = { name: '', permissions: [] };

    @State() error = '';

    @Client()
    togglePermission(perm: Permission, checked: boolean) {
        this.form.permissions = checked
            ? [...this.form.permissions, perm]
            : this.form.permissions.filter((p) => p !== perm);
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) return;
        try {
            await this.create(this.form.name, this.form.permissions);
        } catch (e: any) {
            this.error = e?.message || __('Could not create role');
        }
    }

    @Server()
    async create(name: string, permissions: Permission[]) {
        await createRole({ name, permissions });
        this.redirect('/dashboard/roles');
    }

    render() {
        return html`
            <div class="space-y-8 max-w-2xl">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('New role')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Define a role and the permissions it grants.')}</p>
                </div>

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Details')}</h2>`)}
                    ${component(CardBody, {}, html`
                        ${component(Form, {
                            submit: (e: Event) => this.handleSubmit(e),
                        }, html`
                            ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                            <div class="flex flex-col space-y-6">
                            ${component(Field, { label: __('Name'), for: 'name', error: this.getError('form.name') },
                                component(Input, { id: 'name', type: 'text', placeholder: 'editor', '.value': bind(this.form, 'name') }))}

                            <div>
                                <p class="text-sm font-medium text-foreground mb-2">${__('Permissions')}</p>
                                <div class="space-y-2">
                                    ${PERMISSIONS.map((perm) => html`
                                        <label class="flex items-start gap-3 cursor-pointer">
                                            ${component(Checkbox, {
                                                checked: this.form.permissions.includes(perm),
                                                '@change': (e: any) => this.togglePermission(perm, e.target.checked),
                                            })}
                                            <span>
                                                <span class="block text-sm text-foreground font-mono">${perm}</span>
                                            </span>
                                        </label>
                                    `)}
                                </div>
                            </div>

                            <div class="flex items-center gap-2">
                                ${component(Button, { type: 'submit' }, __('Create role'))}
                                <a href="/dashboard/roles"
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
