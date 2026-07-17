import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Field, Input, Button, Alert, Checkbox } from '@cossackframework/ui';
import { guard } from '../../../../services/rbac';
import { getUser, updateUser, syncUserRoles, type UserDetail } from '../../../../services/users';
import { listRoles, type RoleDetail } from '../../../../services/roles';

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class EditUserPage extends Cossack {
    @State()
    @Validate({ rules: { required: true, email: true, message: 'Enter a valid email' }, config: { trigger: 'all', runOn: 'both' } })
    email = '';

    @State() name = '';
    @State() avatar = '';
    @State() assignedRoleIds: string[] = [];
    @State() allRoles: RoleDetail[] = [];
    // Renamed from `user` — `this.user` is a base-class accessor for the
    // logged-in user; redeclaring it would shadow that and break auth checks.
    @State() userDetail: UserDetail | null = null;
    @State() saved = false;
    @State() error = '';

    onMount() {
        return this.load();
    }

    @Server()
    async load() {
        const id = this.c.req.param('id')!;
        const [user, roles] = await Promise.all([getUser(id), listRoles()]);
        this.allRoles = roles;
        if (!user) {
            this.error = __('User not found');
            return;
        }
        this.userDetail = user;
        this.email = user.email;
        this.name = user.name;
        this.avatar = user.avatar ?? '';
        this.assignedRoleIds = user.roles.map((r) => r.id);
    }

    @Client()
    toggleRole(roleId: string, checked: boolean) {
        this.assignedRoleIds = checked
            ? [...this.assignedRoleIds, roleId]
            : this.assignedRoleIds.filter((id) => id !== roleId);
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
            await this.save(this.name, this.email, this.avatar, this.assignedRoleIds);
            this.saved = true;
            await this.load();
            this.requestUpdate();
        } catch (e: any) {
            this.error = e?.message || __('Could not save user');
            this.requestUpdate();
        }
    }

    @Server()
    async save(name: string, email: string, avatar: string, roleIds: string[]) {
        const id = this.c.req.param('id')!;
        await updateUser(id, { name, email, avatar: avatar || null });
        await syncUserRoles(id, roleIds);
    }

    render() {
        if (!this.userDetail && !this.error) return html`<div class="text-sm text-muted-foreground">${__('Loading…')}</div>`;
        if (!this.userDetail) return html`<div class="text-sm text-destructive">${this.error}</div>`;

        return html`
            <div class="space-y-8 max-w-2xl">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${this.userDetail.name || this.userDetail.email}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Edit user details and roles.')}</p>
                </div>

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Profile')}</h2>`)}
                    ${component(CardBody, {}, html`
                        <form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
                            ${component(Field, { label: __('Name'), for: 'name' },
                                component(Input, { id: 'name', type: 'text', '.value': this.name, '@input': (e: any) => this.setProperty('name', e.target.value) }))}
                            ${component(Field, { label: __('Email'), for: 'email', error: this.getError('email') },
                                component(Input, { id: 'email', type: 'email', '.value': this.email, '@input': (e: any) => this.setProperty('email', e.target.value) }))}
                            ${component(Field, { label: __('Avatar URL'), for: 'avatar' },
                                component(Input, { id: 'avatar', type: 'url', placeholder: 'https://...', '.value': this.avatar, '@input': (e: any) => this.setProperty('avatar', e.target.value) }))}
                            ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                            ${this.saved ? component(Alert, { variant: 'success' }, __('Saved.')) : null}
                            ${component(Button, { type: 'submit' }, __('Save changes'))}
                        </form>
                    `)}
                `)}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Roles')}</h2>`)}
                    ${component(CardBody, {}, html`
                        <div class="space-y-3">
                            ${this.allRoles.length === 0
                                ? html`<p class="text-sm text-muted-foreground">${__('No roles defined yet.')}</p>`
                                : this.allRoles.map((role) => html`
                                    <label class="flex items-start gap-3 cursor-pointer">
                                        ${component(Checkbox, {
                                            checked: this.assignedRoleIds.includes(role.id),
                                            '@change': (e: any) => this.toggleRole(role.id, e.target.checked),
                                        })}
                                        <span>
                                            <span class="block text-sm font-medium text-foreground">${role.name}</span>
                                            <span class="block text-xs text-muted-foreground">${role.permissions.join(', ') || __('No permissions')}</span>
                                        </span>
                                    </label>
                                `)}
                        </div>
                    `)}
                `)}
            </div>
        `;
    }
}
