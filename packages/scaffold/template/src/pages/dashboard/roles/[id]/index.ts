import { Cossack, Page, State, Store, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Field, Input, Button, Checkbox, Form, toast } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { guard } from '../../../../services/rbac';
import { getRole, updateRole, type RoleDetail } from '../../../../services/roles';
import { PERMISSIONS, type Permission } from '../../../../lib/permissions';

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class EditRolePage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<RoleDetail>({
            name: { required: true, message: 'Name is required' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    role: RoleDetail | null = null;

    @State() selected: Permission[] = [];
    @State() saved = false;
    @State() error = '';

    @Server()
    async init() {
        const id = this.c.req.param('id')!;
        const role = await getRole(id);
        if (!role) {
            this.error = __('Role not found');
            return;
        }
        this.role = role;
        this.selected = role.permissions as Permission[];
    }

    @Client()
    togglePermission(perm: Permission, checked: boolean) {
        this.selected = checked
            ? [...this.selected, perm]
            : this.selected.filter((p) => p !== perm);
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        this.saved = false;
        const ok = await this.validateAll();
        if (!ok) return;

        try {
            await this.save(this.role, this.selected);
            this.saved = true;
            toast.success(__('Saved.'));
        } catch (e: any) {
            this.error = e?.message || __('Could not save role');
            toast.error(this.error);
        }
    }

    @Server()
    async save(role: RoleDetail | null, permissions: Permission[]) {
        if (!role) throw new Error(__('Role not found'));
        await updateRole(role.id, { name: role.name, permissions });
    }

    render() {
        if (!this.role && !this.error) return html`<div class="text-sm text-muted-foreground">${__('Loading…')}</div>`;
        if (!this.role) return html`<div class="text-sm text-destructive">${this.error}</div>`;

        return html`
            <div class="space-y-8 max-w-2xl">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${this.role.name}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Edit the role and its permissions.')}</p>
                </div>

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Details')}</h2>`)}
                    ${component(CardBody, {}, html`
                        ${component(Form, {
                            submit: (e: Event) => this.handleSubmit(e),
                        }, html`
                            <div class="flex flex-col space-y-6">
                            ${component(Field, { label: __('Name'), for: 'name', error: this.getError('name') },
                                component(Input, { id: 'name', type: 'text', '.value': bind(this.role, 'name') }))}

                            <div>
                                <p class="text-sm font-medium text-foreground mb-2">${__('Permissions')}</p>
                                <div class="space-y-2">
                                    ${PERMISSIONS.map((perm) => html`
                                        <label class="flex items-start gap-3 cursor-pointer">
                                            ${component(Checkbox, {
                                                checked: this.selected.includes(perm),
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
                                ${component(Button, { type: 'submit' }, __('Save changes'))}
                                <a href="/dashboard/roles"
                                   class="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                                    ${__('Back')}
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
