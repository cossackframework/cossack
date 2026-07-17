import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Field, Input, Button, Alert, Checkbox } from '@cossackframework/ui';
import { guard } from '../../../../services/rbac';
import { getRole, updateRole, type RoleDetail } from '../../../../services/roles';
import { PERMISSIONS, type Permission } from '../../../../config/permissions';

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class EditRolePage extends Cossack {
    @State()
    @Validate({ rules: { required: true, message: 'Name is required' }, config: { trigger: 'all', runOn: 'both' } })
    name = '';

    @State() selected: Permission[] = [];
    @State() role: RoleDetail | null = null;
    @State() saved = false;
    @State() error = '';

    onMount() {
        return this.load();
    }

    @Server()
    async load() {
        const id = this.c.req.param('id')!;
        const role = await getRole(id);
        if (!role) {
            this.error = __('Role not found');
            return;
        }
        this.role = role;
        this.name = role.name;
        this.selected = role.permissions as Permission[];
    }

    @Client()
    togglePermission(perm: Permission, checked: boolean) {
        this.selected = checked
            ? [...this.selected, perm]
            : this.selected.filter((p) => p !== perm);
        this.requestUpdate();
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        this.saved = false;
        const ok = await this.validateAll();
        if (!ok) { this.requestUpdate(); return; }
        try {
            await this.save(this.name, this.selected);
            this.saved = true;
            await this.load();
            this.requestUpdate();
        } catch (e: any) {
            this.error = e?.message || __('Could not save role');
            this.requestUpdate();
        }
    }

    @Server()
    async save(name: string, permissions: Permission[]) {
        const id = this.c.req.param('id')!;
        await updateRole(id, { name, permissions });
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
                        <form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-6">
                            ${component(Field, { label: __('Name'), for: 'name', error: this.getError('name') },
                                component(Input, { id: 'name', type: 'text', '.value': this.name, '@input': (e: any) => this.setProperty('name', e.target.value) }))}

                            <div>
                                <p class="text-sm font-medium text-foreground mb-2">${__('Permissions')}</p>
                                <div class="space-y-2">
                                    ${PERMISSIONS.map((perm) => html`
                                        <label class="flex items-center gap-3 cursor-pointer">
                                            ${component(Checkbox, {
                                                checked: this.selected.includes(perm),
                                                '@change': (e: any) => this.togglePermission(perm, e.target.checked),
                                            })}
                                            <span class="text-sm text-foreground font-mono">${perm}</span>
                                        </label>
                                    `)}
                                </div>
                            </div>

                            ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                            ${this.saved ? component(Alert, { variant: 'success' }, __('Saved.')) : null}
                            <div class="flex items-center gap-2">
                                ${component(Button, { type: 'submit' }, __('Save changes'))}
                                <a href="/dashboard/roles"
                                   class="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                                    ${__('Back')}
                                </a>
                            </div>
                        </form>
                    `)}
                `)}
            </div>
        `;
    }
}
